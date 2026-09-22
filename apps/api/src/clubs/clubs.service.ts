import { Injectable } from '@nestjs/common';
import {
  IMAGE_KINDS,
  type ClubDetail,
  type CommitteeMember,
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
import { matches, PERMISSIONS, type PlatformRole } from '../auth/permissions';
import { cursorArgs, cursorPage } from '../common/cursor-page';
import { NotFoundError, UnprocessableError } from '../common/problem/domain-error';
import { conflictOn } from '../common/prisma-constraint';
import type { Prisma, Club as ClubRow } from '../generated/prisma/client';
import { TransactionHost } from '../prisma/transaction.host';
import { objectPath } from '../storage/image-kinds';
import { StorageService } from '../storage/storage.service';
import { assertAcceptsEdits, assertTransition } from './club-status';
import { loadClub } from './load-club';
import { canReadInactiveClub } from './roster-access';
import { deriveSlug, uniqueSlug } from './slug';

const ACTIVE_ONLY = { status: 'ACTIVE' } as const;

/** What a club has actually run. Drives the `eventsRun` stat. */
const RAN: Prisma.EventWhereInput = { status: { in: ['COMPLETED', 'CERTIFIED'] } };

/** Lead first, then the order the roles are listed in the enum. A committee
 *  sorted by id puts whoever was appointed first at the top, which is noise. */
const ROLE_ORDER: Record<CommitteeMember['role'], number> = {
  LEAD: 0,
  VICE_LEAD: 1,
  OPERATIONS: 2,
  CTO: 3,
  MARKETING: 4,
};

const COMMITTEE_INCLUDE = {
  where: ACTIVE_ONLY,
  select: { userId: true, role: true, acceptedAt: true, user: { select: { fullName: true } } },
} as const;

function toCommittee(
  rows: { userId: string; role: CommitteeMember['role']; acceptedAt: Date | null; user: { fullName: string } }[],
): CommitteeMember[] {
  return rows
    .map((a) => ({
      userId: a.userId,
      fullName: a.user.fullName,
      role: a.role,
      since: a.acceptedAt?.toISOString() ?? null,
    }))
    .sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role]);
}

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

interface DetailExtras {
  viewerMembershipStatus: ClubDetail['viewerMembershipStatus'];
  viewerClubRoles: ClubDetail['viewerClubRoles'];
  committee: CommitteeMember[];
  pendingMemberCount: ClubDetail['pendingMemberCount'];
  eventsRun: number;
}

function toClubDetail(
  row: ClubRow,
  departmentName: string,
  memberCount: number,
  extras: DetailExtras,
): ClubDetail {
  return {
    ...toClubSummary(row, departmentName, memberCount),
    description: row.description,
    academicYear: row.academicYear,
    bannerUrl: row.bannerUrl,
    departmentId: row.departmentId,
    ...extras,
  };
}

/** A club nobody has joined, run an event for, or appointed anyone to.
 *  Only reachable from `create`, which is Admin-only, hence 0 rather than
 *  null: an Admin may always see the count, and there is nothing pending. */
const NO_EXTRAS: DetailExtras = {
  viewerMembershipStatus: null,
  viewerClubRoles: [],
  committee: [],
  pendingMemberCount: 0,
  eventsRun: 0,
};

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

      // A brand new club has no memberships, officers or events yet.
      return toClubDetail(row, row.department.name, 0, NO_EXTRAS);
    });
  }

  async list(actor: Actor, query: ClubListQuery): Promise<ClubPage> {
    // Anyone but an Admin sees ACTIVE clubs only, whatever they asked for. A
    // suspended club is hidden, and a filter the caller controls is not what
    // hides it.
    const status = actor.platformRole === 'ADMIN' ? query.status : 'ACTIVE';

    const where: Prisma.ClubWhereInput = {
      ...(query.departmentId ? { departmentId: query.departmentId } : {}),
      ...(status ? { status } : {}),
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
  async detail(actor: Actor, clubId: string): Promise<ClubDetail> {
    return this.detailWhere(actor, { id: clubId });
  }

  async detailBySlug(actor: Actor, slug: string): Promise<ClubDetail> {
    return this.detailWhere(actor, { slug });
  }

  /**
   * One round trip for an ordinary viewer, two for one who can decide
   * membership: the club, its department, its committee, both counts and the
   * viewer's own membership all come back together, and pendingMemberCount is
   * the only part that ever costs a second query.
   *
   * Callable in parallel because nothing here runs inside a transaction any
   * more: `update` and `updateStatus` re-read AFTER theirs commits.
   */
  private async detailWhere(
    actor: Actor,
    where: { id: string } | { slug: string },
  ): Promise<ClubDetail> {
    const club = await this.host.tx.club.findUnique({
      where,
      include: {
        department: { select: { name: true } },
        appointments: COMMITTEE_INCLUDE,
        // Scoped to `actor.id`, and ordered: without the filter this answers
        // with whichever row comes first and tells a student they belong to a
        // club they never joined.
        memberships: {
          where: { userId: actor.id },
          orderBy: { requestedAt: 'desc' },
          take: 1,
          select: { status: true },
        },
        _count: { select: { memberships: { where: ACTIVE_ONLY }, events: { where: RAN } } },
      },
    });
    if (!club) throw new NotFoundError('No such club.');
    const clubId = club.id;

    // 404 rather than 403: that a club exists under this slug is itself the
    // leak, and a student must never learn a suspended club is there.
    if (club.status !== 'ACTIVE' && !(await canReadInactiveClub(this.host, actor, clubId))) {
      throw new NotFoundError('No such club.');
    }

    const viewerClubRoles = club.appointments
      .filter((a) => a.userId === actor.id)
      .map((a) => a.role);

    // A second query rather than a second `_count` entry: Prisma cannot alias
    // two filtered counts of one relation. Skipped entirely for a viewer who
    // may not see it, and null for them rather than 0, so the Manage badge
    // cannot vanish for the wrong reason.
    const canDecide = matches(PERMISSIONS['membership:decide'], {
      userId: actor.id,
      platformRole: actor.platformRole,
      clubRoles: viewerClubRoles,
      eventResponsibilities: [],
    });

    const pendingMemberCount = canDecide
      ? await this.host.tx.clubMembership.count({ where: { clubId, status: 'PENDING' } })
      : null;

    return toClubDetail(club, club.department.name, club._count.memberships, {
      viewerMembershipStatus: club.memberships[0]?.status ?? null,
      viewerClubRoles,
      committee: toCommittee(club.appointments),
      pendingMemberCount,
      eventsRun: club._count.events,
    });
  }

  // `data` is built key by key, never spread, so a body carrying `status` or
  // `slug` cannot smuggle either into the update. The schema has no such keys,
  // but a service must not rely on that alone.
  async update(actor: Actor, clubId: string, body: PatchClubBody): Promise<ClubDetail> {
    await this.host.run(async () => {
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
    });

    // Outside the transaction on purpose. The write and its audit row are what
    // had to be atomic; the response is a read of what committed, and out here
    // `detailWhere` may run its queries in parallel.
    return this.detail(actor, clubId);
  }

  // `assertTransition` is the only gate on the write; nothing assigns `status`
  // outside it.
  async updateStatus(actor: Actor, clubId: string, body: PatchClubStatusBody): Promise<ClubDetail> {
    await this.host.run(async () => {
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
    });

    // Outside the transaction, for the same reason `update`'s is.
    return this.detail(actor, clubId);
  }
}
