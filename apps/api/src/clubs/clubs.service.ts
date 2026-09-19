import { Injectable } from '@nestjs/common';
import {
  IMAGE_KINDS,
  type ClubDetail,
  type ClubListQuery,
  type ClubPage,
  type ClubSummary,
  type CreateClubBody,
  type ImageKind,
  type NewClubUpload,
  type PatchClubBody,
  type PatchClubStatusBody,
  type SignedUpload,
} from '@majlis/contracts';
import { v7 as uuidv7 } from 'uuid';
import { AuditService } from '../audit/audit.service';
import { CLUB_FIELDS, assertFieldsAllowed, overrideReasonFor } from '../auth/field-permissions';
import { resolveClubFacts } from '../auth/permissions.guard';
import type { PlatformRole } from '../auth/permissions';
import { cursorArgs, cursorPage } from '../common/cursor-page';
import { NotFoundError, UnprocessableError } from '../common/problem/domain-error';
import { conflictOn } from '../common/prisma-constraint';
import type { Prisma, Club as ClubRow } from '../generated/prisma/client';
import { TransactionHost } from '../prisma/transaction.host';
import { objectPath } from '../storage/image-kinds';
import { StorageService } from '../storage/storage.service';
import { assertAcceptsEdits, assertTransition } from './club-status';
import { loadClub } from './load-club';
import { deriveSlug, uniqueSlug } from './slug';

const ACTIVE_ONLY = { status: 'ACTIVE' } as const;

interface Actor {
  id: string;
  platformRole: PlatformRole;
}

function toClubSummary(row: ClubRow, departmentName: string, memberCount: number): ClubSummary {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    category: row.category,
    logoUrl: row.logoUrl,
    status: row.status,
    membershipPolicy: row.membershipPolicy,
    departmentName,
    memberCount,
  };
}

function toClubDetail(
  row: ClubRow,
  departmentName: string,
  memberCount: number,
  viewerMembershipStatus: ClubDetail['viewerMembershipStatus'],
  viewerClubRoles: ClubDetail['viewerClubRoles'],
): ClubDetail {
  return {
    ...toClubSummary(row, departmentName, memberCount),
    description: row.description,
    academicYear: row.academicYear,
    bannerUrl: row.bannerUrl,
    departmentId: row.departmentId,
    viewerMembershipStatus,
    viewerClubRoles,
  };
}

/**
 * `uniqueSlug`'s pre-check is not a guarantee under READ COMMITTED: two
 * concurrent creates deriving the same base slug can both see it free, so the
 * loser must be told which constraint fired rather than blamed for a name
 * collision that never happened. `conflictOn` matches each branch positively.
 */
const mapWriteError = conflictOn({
  slug: 'A club with that slug already exists.',
  name: 'A club with that name already exists.',
});

@Injectable()
export class ClubsService {
  constructor(
    private readonly host: TransactionHost,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
  ) {}

  // Mints the id the club will be created with, so the object path derived from
  // it exists before the club does.
  async mintLogoUpload(): Promise<NewClubUpload> {
    const clubId = uuidv7();
    const path = objectPath('club-logo', clubId);
    const { signedUrl, token } = await this.storage.createSignedUploadUrl(path);
    return { clubId, path, signedUrl, token, publicUrl: this.storage.publicUrlFor(path, Date.now()) };
  }

  /**
   * A signed URL for `resourceId`'s object path, with no gate of its own. Only
   * callers minting against an entity that does not exist yet use it directly;
   * minting against a live object is gated first, below and in EventsService.
   */
  async mintEditUpload(resourceId: string, kind: ImageKind): Promise<SignedUpload> {
    const path = objectPath(kind, resourceId);
    const { signedUrl, token } = await this.storage.createSignedUploadUrl(path);
    return { path, signedUrl, token, publicUrl: this.storage.publicUrlFor(path, Date.now()) };
  }

  /**
   * The URL overwrites the live public object, which makes this an edit, so it
   * takes `update`'s status gate: otherwise an officer of an ARCHIVED club could
   * replace its logo through the one path that refused nothing. The audit row is
   * the only record of the replacement, the bytes never passing through the API,
   * and is written in the same transaction.
   */
  async mintClubImageUpload(actor: { id: string }, clubId: string, kind: ImageKind): Promise<SignedUpload> {
    return this.host.run(async () => {
      await loadClub(this.host, clubId, assertAcceptsEdits);
      const upload = await this.mintEditUpload(clubId, kind);

      await this.audit.record({
        action: 'club.upload_url_minted',
        entityType: 'Club',
        entityId: clubId,
        outcome: 'SUCCESS',
        actorUserId: actor.id,
        after: { kind, path: upload.path },
      });

      return upload;
    });
  }

  // The API never sees the image bytes, so no handler stores a URL it has not
  // confirmed. Returns the versioned public URL to store.
  async verifyUpload(kind: ImageKind, resourceId: string): Promise<string> {
    const path = objectPath(kind, resourceId);
    const stat = await this.storage.statObject(path);

    if (!stat) throw new UnprocessableError('That image was not uploaded.');
    if (stat.contentType !== 'image/webp') throw new UnprocessableError('That image is not a WebP.');
    if (stat.size > IMAGE_KINDS[kind].maxBytes) throw new UnprocessableError('That image is too large.');

    return this.storage.publicUrlFor(path, Date.now());
  }

  async create(actor: { id: string }, body: CreateClubBody): Promise<ClubDetail> {
    return this.host.run(async () => {
      const logoUrl = await this.verifyUpload('club-logo', body.clubId);
      const slug = await uniqueSlug(deriveSlug(body.name), (s) =>
        this.host.tx.club.count({ where: { slug: s } }).then((n) => n > 0),
      );

      const row = await this.host.tx.club
        .create({
          data: {
            id: body.clubId,
            departmentId: body.departmentId,
            name: body.name,
            slug,
            description: body.description,
            category: body.category,
            academicYear: body.academicYear,
            logoUrl,
            membershipPolicy: body.membershipPolicy,
          },
          include: { department: { select: { name: true } } },
        })
        .catch(mapWriteError);

      await this.audit.record({
        action: 'club.created',
        entityType: 'Club',
        entityId: row.id,
        outcome: 'SUCCESS',
        actorUserId: actor.id,
        after: { name: row.name, slug: row.slug, departmentId: row.departmentId },
      });

      // A brand new club has no memberships yet.
      return toClubDetail(row, row.department.name, 0, null, []);
    });
  }

  async list(query: ClubListQuery): Promise<ClubPage> {
    const where: Prisma.ClubWhereInput = {
      ...(query.departmentId ? { departmentId: query.departmentId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.q ? { name: { contains: query.q, mode: 'insensitive' as const } } : {}),
    };

    const rows = await this.host.tx.club.findMany({
      where,
      ...cursorArgs(query),
      include: {
        department: { select: { name: true } },
        _count: { select: { memberships: { where: ACTIVE_ONLY } } },
      },
    });

    const { items, nextCursor } = cursorPage(rows, query.limit);

    return {
      items: items.map((c) => toClubSummary(c, c.department.name, c._count.memberships)),
      nextCursor,
    };
  }

  // The membership and appointment reads in detailWhere are scoped to
  // `actor.id`: without that filter they answer with whichever row comes first,
  // telling a student they belong to a club they never joined.
  async detail(actor: { id: string }, clubId: string): Promise<ClubDetail> {
    return this.detailWhere(actor, { id: clubId });
  }

  async detailBySlug(actor: { id: string }, slug: string): Promise<ClubDetail> {
    return this.detailWhere(actor, { slug });
  }

  private async detailWhere(
    actor: { id: string },
    where: { id: string } | { slug: string },
  ): Promise<ClubDetail> {
    const club = await this.host.tx.club.findUnique({
      where,
      include: {
        department: { select: { name: true } },
        _count: { select: { memberships: { where: ACTIVE_ONLY } } },
      },
    });
    if (!club) throw new NotFoundError('No such club.');
    const clubId = club.id;

    const membership = await this.host.tx.clubMembership.findFirst({
      where: { clubId, userId: actor.id },
      orderBy: { requestedAt: 'desc' },
    });
    const appointments = await this.host.tx.clubTeamAppointment.findMany({
      where: { clubId, userId: actor.id, status: 'ACTIVE' },
    });

    return toClubDetail(
      club,
      club.department.name,
      club._count.memberships,
      membership?.status ?? null,
      appointments.map((a) => a.role),
    );
  }

  // `data` is built key by key, never spread, so a body carrying `status` or
  // `slug` cannot smuggle either into the update. The schema has no such keys,
  // but a service must not rely on that alone.
  async update(actor: Actor, clubId: string, body: PatchClubBody): Promise<ClubDetail> {
    return this.host.run(async () => {
      await loadClub(this.host, clubId, assertAcceptsEdits);

      // Re-derived from the database, not carried over from the guard: the field
      // gate is a second authorization decision.
      const { clubRoles } = await resolveClubFacts(this.host, actor.id, clubId);
      const facts = { platformRole: actor.platformRole, clubRoles };

      // overrideReason is a meta field, not a column, so it is held out of the
      // field gate: CLUB_FIELDS has no entry for it and would fail closed.
      const { overrideReason, ...fields } = body;
      assertFieldsAllowed(fields, CLUB_FIELDS, facts);
      const reason = overrideReasonFor(facts, overrideReason);

      const data: Prisma.ClubUncheckedUpdateInput = {};
      if (body.departmentId !== undefined) data.departmentId = body.departmentId;
      if (body.description !== undefined) data.description = body.description;
      if (body.category !== undefined) data.category = body.category;
      if (body.academicYear !== undefined) data.academicYear = body.academicYear;
      if (body.membershipPolicy !== undefined) data.membershipPolicy = body.membershipPolicy;
      if (body.logoUploaded) data.logoUrl = await this.verifyUpload('club-logo', clubId);
      if (body.bannerUploaded) data.bannerUrl = await this.verifyUpload('club-banner', clubId);

      await this.host.tx.club.update({ where: { id: clubId }, data });

      await this.audit.record({
        action: 'club.updated',
        entityType: 'Club',
        entityId: clubId,
        outcome: 'SUCCESS',
        actorUserId: actor.id,
        ...(reason ? { reason } : {}),
        after: data as Record<string, unknown>,
      });

      return this.detail(actor, clubId);
    });
  }

  // `assertTransition` is the only gate on the write; nothing assigns `status`
  // outside it.
  async updateStatus(actor: { id: string }, clubId: string, body: PatchClubStatusBody): Promise<ClubDetail> {
    return this.host.run(async () => {
      const before = await loadClub(this.host, clubId);
      assertTransition(before.status, body.status);

      const after = await this.host.tx.club.update({ where: { id: clubId }, data: { status: body.status } });

      const action =
        body.status === 'ARCHIVED' ? 'club.archived' : body.status === 'SUSPENDED' ? 'club.suspended' : 'club.reactivated';

      await this.audit.record({
        action,
        entityType: 'Club',
        entityId: clubId,
        outcome: 'SUCCESS',
        reason: body.reason,
        actorUserId: actor.id,
        before: { status: before.status },
        after: { status: after.status },
      });

      return this.detail(actor, clubId);
    });
  }
}
