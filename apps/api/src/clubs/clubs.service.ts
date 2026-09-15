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
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- value import: Nest DI resolves this from design:paramtypes.
import { AuditService } from '../audit/audit.service';
import { CLUB_FIELDS, assertFieldsAllowed, overrideReasonFor } from '../auth/field-permissions';
import { resolveClubFacts } from '../auth/permissions.guard';
import type { PlatformRole } from '../auth/permissions';
import { cursorArgs, cursorPage } from '../common/cursor-page';
import { NotFoundError, UnprocessableError } from '../common/problem/domain-error';
import { conflictOn } from '../common/prisma-constraint';
import type { Prisma, Club as ClubRow } from '../generated/prisma/client';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- must stay a value import: Nest's constructor DI resolves this provider from the emitted `design:paramtypes` metadata, which needs a real runtime reference.
import { TransactionHost } from '../prisma/transaction.host';
import { objectPath } from '../storage/image-kinds';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- must stay a value import: same reason as AuditService above.
import { StorageService } from '../storage/storage.service';
import { assertAcceptsEdits, assertTransition } from './club-status';
import { loadClub } from './load-club';
import { deriveSlug, uniqueSlug } from './slug';

const ACTIVE_ONLY = { status: 'ACTIVE' } as const;

/** Only what the service reads off the signed-in user. */
interface Actor {
  id: string;
  platformRole: PlatformRole;
}

/** Maps a club row plus its computed fields onto the wire summary shape. */
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

/** Extends the summary with the fields only the detail read carries. */
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
 * P2002 here is the unique violation on either name or slug. `uniqueSlug`'s
 * pre-check is not a guarantee under READ COMMITTED: two concurrent creates
 * with different names that derive the same base slug can both see it free,
 * so the loser must still be told which constraint actually fired rather
 * than being blamed for a name collision that never happened.
 *
 * `conflictOn` matches each branch positively, never by default. See
 * `test/clubs-create.integration.test.ts`'s name-collision test, which needs
 * that to discriminate a broken `violatedConstraintName`.
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

  /**
   * POST /uploads/club-logo. Mints the id the club will be created with, so
   * the object path (derived from that id) exists before the upload does,
   * plus a one-use signed URL to upload to that path.
   */
  async mintLogoUpload(): Promise<NewClubUpload> {
    const clubId = uuidv7();
    const path = objectPath('club-logo', clubId);
    const { signedUrl, token } = await this.storage.createSignedUploadUrl(path);
    return { clubId, path, signedUrl, token, publicUrl: this.storage.publicUrlFor(path, Date.now()) };
  }

  /**
   * A signed URL for `resourceId`'s object path, with no gate of its own.
   * Callers that mint against an entity which does not exist yet (a club or
   * an event being created) use this directly; the two that mint against a
   * live object gate it first, below and in EventsService.
   */
  async mintEditUpload(resourceId: string, kind: ImageKind): Promise<SignedUpload> {
    const path = objectPath(kind, resourceId);
    const { signedUrl, token } = await this.storage.createSignedUploadUrl(path);
    return { path, signedUrl, token, publicUrl: this.storage.publicUrlFor(path, Date.now()) };
  }

  /**
   * POST /clubs/:clubId/logo-upload-url and .../banner-upload-url. The club
   * already exists, so the object path is derived from its real id rather
   * than a freshly minted one, and the URL overwrites the live public object.
   *
   * That makes this an edit, and it takes `update`'s status gate: without it
   * an officer of an ARCHIVED club could replace its public logo through the
   * one path that refused nothing. The audit row is the only record the
   * object was replaced at all, since the bytes never pass through the API,
   * and is written in the same transaction so a failed mint leaves no trace
   * of a URL nobody received.
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

  /**
   * The API never sees the image bytes, so no handler stores a URL it has
   * not confirmed. Returns the versioned public URL to store.
   */
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

  /** GET /clubs. Same cursor pattern as UsersService.list and DepartmentsService.list. */
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

  /**
   * GET /clubs/:clubId. The membership and appointment reads are scoped to
   * `actor.id`: a query missing that filter would answer with whichever row
   * happens to come first, telling a student they belong to a club they
   * never joined.
   */
  async detail(actor: { id: string }, clubId: string): Promise<ClubDetail> {
    return this.detailWhere(actor, { id: clubId });
  }

  /** GET /clubs/by-slug/:slug. The slug is the club's public identifier. */
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

  /**
   * PATCH /clubs/:clubId. `data` is built by picking each optional key from
   * `body` explicitly, never spread, so a body carrying `status` or `slug`
   * (patchClubBodySchema has no such keys, but a service must not rely on
   * that alone) cannot smuggle either into the update.
   */
  async update(actor: Actor, clubId: string, body: PatchClubBody): Promise<ClubDetail> {
    return this.host.run(async () => {
      await loadClub(this.host, clubId, assertAcceptsEdits);

      // Re-derived from the database here rather than carried over from the
      // guard: the field gate is a second authorization decision and must
      // not trust anything the first one left on the request.
      const { clubRoles } = await resolveClubFacts(this.host, actor.id, clubId);
      const facts = { platformRole: actor.platformRole, clubRoles };

      // overrideReason is a meta field, not a column, so it is held out of the
      // field gate (CLUB_FIELDS has no entry for it, which fails closed).
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

  /**
   * PATCH /clubs/:clubId/status. `assertTransition` is the only gate on the
   * write; nothing here assigns `status` directly outside it.
   */
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
