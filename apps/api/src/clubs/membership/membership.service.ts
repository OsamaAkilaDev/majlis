import { Injectable } from '@nestjs/common';
import type {
  AddMemberBody,
  CursorPageQuery,
  DecideMembershipBody,
  Member,
  MemberListQuery,
  MemberPage,
  MyClubPage,
} from '@majlis/contracts';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- value import: Nest DI resolves this from design:paramtypes.
import { AuditService } from '../../audit/audit.service';
import { ConflictError, NotFoundError, UnprocessableError } from '../../common/problem/domain-error';
import type { ClubRole } from '../../generated/prisma/enums';
import { Prisma, type ClubMembership as MembershipRow } from '../../generated/prisma/client';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- must stay a value import: Nest's constructor DI resolves this provider from the emitted `design:paramtypes` metadata, which needs a real runtime reference.
import { TransactionHost } from '../../prisma/transaction.host';
import { assertAcceptsEdits, assertAcceptsNewActivity } from '../club-status';

const WITH_USER = { user: { select: { fullName: true, email: true } } } as const;
type MembershipWithUser = MembershipRow & { user: { fullName: string; email: string } };
interface AppointmentRoleRow {
  clubId: string;
  userId: string;
  role: ClubRole;
}

/** Maps a membership row plus its club roles onto the wire shape. */
function toMember(row: MembershipWithUser, clubRoles: ClubRole[]): Member {
  return {
    id: row.id,
    userId: row.userId,
    userFullName: row.user.fullName,
    userEmail: row.user.email,
    status: row.status,
    requestedAt: row.requestedAt.toISOString(),
    decidedAt: row.decidedAt?.toISOString() ?? null,
    clubRoles,
  };
}

/** Groups active-appointment rows by whichever key the caller is batching on. */
function groupRoles(rows: AppointmentRoleRow[], key: (r: AppointmentRoleRow) => string): Map<string, ClubRole[]> {
  const map = new Map<string, ClubRole[]>();
  for (const r of rows) map.set(key(r), [...(map.get(key(r)) ?? []), r.role]);
  return map;
}

/**
 * P2002 here is club_membership_one_open_per_user, hand-written SQL rather than a
 * Prisma `@@unique`, so meta.target is the raw index name rather than a
 * column list, same shape as TeamService.mapWriteError's Lead index. Applied
 * to every write that can create an open row (request, addMember): both
 * insert into the same table under the same partial index.
 */
function mapWriteError(e: unknown): never {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
    const target = e.meta?.target;
    const columns = Array.isArray(target) ? target : typeof target === 'string' ? [target] : [];
    if (columns.some((c) => c.includes('one_open_per_user'))) {
      throw new ConflictError('You already have an open membership in that club.');
    }
  }
  throw e;
}

@Injectable()
export class MembershipService {
  constructor(
    private readonly host: TransactionHost,
    private readonly audit: AuditService,
  ) {}

  private async activeAppointments(where: Prisma.ClubTeamAppointmentWhereInput): Promise<AppointmentRoleRow[]> {
    return this.host.tx.clubTeamAppointment.findMany({
      where: { ...where, status: 'ACTIVE' },
      select: { clubId: true, userId: true, role: true },
    });
  }

  private async rolesForMany(clubId: string, userIds: string[]): Promise<Map<string, ClubRole[]>> {
    const rows = await this.activeAppointments({ clubId, userId: { in: userIds } });
    return groupRoles(rows, (r) => r.userId);
  }

  private async rolesForUserAcrossClubs(userId: string, clubIds: string[]): Promise<Map<string, ClubRole[]>> {
    const rows = await this.activeAppointments({ userId, clubId: { in: clubIds } });
    return groupRoles(rows, (r) => r.clubId);
  }

  private async rolesFor(clubId: string, userId: string): Promise<ClubRole[]> {
    return (await this.rolesForMany(clubId, [userId])).get(userId) ?? [];
  }

  /**
   * POST /clubs/:clubId/membership-requests. Self-scoped; no
   * @RequirePermission, the row is always the actor's own.
   */
  async request(actor: { id: string }, clubId: string): Promise<Member> {
    return this.host.run(async () => {
      const club = await this.host.tx.club.findUnique({ where: { id: clubId } });
      if (!club) throw new NotFoundError('No such club.');
      assertAcceptsNewActivity(club.status);

      let status: 'ACTIVE' | 'PENDING';
      if (club.membershipPolicy === 'OPEN') status = 'ACTIVE';
      else if (club.membershipPolicy === 'APPROVAL_REQUIRED') status = 'PENDING';
      else throw new UnprocessableError('That club is not open for membership requests.');

      const row = await this.host.tx.clubMembership
        .create({ data: { clubId, userId: actor.id, status }, include: WITH_USER })
        .catch(mapWriteError);

      await this.audit.record({
        action: status === 'ACTIVE' ? 'club.membership_joined' : 'club.membership_requested',
        entityType: 'ClubMembership',
        entityId: row.id,
        outcome: 'SUCCESS',
        actorUserId: actor.id,
        after: { clubId, userId: actor.id, status: row.status },
      });

      return toMember(row, await this.rolesFor(clubId, actor.id));
    });
  }

  /** POST /clubs/:clubId/members. The way in under INVITE_ONLY; also usable under any other policy. */
  async addMember(actor: { id: string }, clubId: string, body: AddMemberBody): Promise<Member> {
    return this.host.run(async () => {
      const club = await this.host.tx.club.findUnique({ where: { id: clubId } });
      if (!club) throw new NotFoundError('No such club.');
      assertAcceptsNewActivity(club.status);

      const row = await this.host.tx.clubMembership
        .create({
          data: { clubId, userId: body.userId, status: 'ACTIVE', decidedById: actor.id, decidedAt: new Date() },
          include: WITH_USER,
        })
        .catch(mapWriteError);

      await this.audit.record({
        action: 'club.member_added',
        entityType: 'ClubMembership',
        entityId: row.id,
        outcome: 'SUCCESS',
        actorUserId: actor.id,
        after: { clubId, userId: row.userId, status: row.status },
      });

      return toMember(row, await this.rolesFor(clubId, row.userId));
    });
  }

  /**
   * PATCH /clubs/:clubId/membership-requests/:requestId. Scoping the read to
   * `{ id: requestId, clubId }` is what makes a request from another club a
   * plain 404 rather than a cross-club decision (RULING D5).
   */
  async decide(actor: { id: string }, clubId: string, requestId: string, body: DecideMembershipBody): Promise<Member> {
    return this.host.run(async () => {
      const existing = await this.host.tx.clubMembership.findFirst({ where: { id: requestId, clubId } });
      if (!existing) throw new NotFoundError('No such membership request.');
      // Main spec 6.2: an officer cannot decide their own request.
      if (existing.userId === actor.id) throw new UnprocessableError('You cannot decide your own membership request.');
      if (existing.status !== 'PENDING') throw new UnprocessableError('That request is not pending.');

      const row = await this.host.tx.clubMembership.update({
        where: { id: existing.id },
        data: { status: body.status, decidedAt: new Date(), decidedById: actor.id, decisionReason: body.reason ?? null },
        include: WITH_USER,
      });

      await this.audit.record({
        action: body.status === 'ACTIVE' ? 'club.membership_approved' : 'club.membership_rejected',
        entityType: 'ClubMembership',
        entityId: row.id,
        outcome: 'SUCCESS',
        reason: body.reason,
        actorUserId: actor.id,
        before: { status: existing.status },
        after: { status: row.status },
      });

      return toMember(row, await this.rolesFor(clubId, row.userId));
    });
  }

  /** DELETE /clubs/:clubId/membership. Self-scoped; the caller leaves their own open membership. */
  async leave(actor: { id: string }, clubId: string): Promise<void> {
    return this.host.run(async () => {
      const club = await this.host.tx.club.findUnique({ where: { id: clubId } });
      if (!club) throw new NotFoundError('No such club.');
      assertAcceptsEdits(club.status);

      const existing = await this.host.tx.clubMembership.findFirst({
        where: { clubId, userId: actor.id, status: { in: ['PENDING', 'ACTIVE'] } },
      });
      if (!existing) throw new NotFoundError('You have no open membership in that club.');

      const row = await this.host.tx.clubMembership.update({
        where: { id: existing.id },
        data: { status: 'LEFT', decidedAt: new Date(), decidedById: actor.id },
      });

      await this.audit.record({
        action: 'club.membership_left',
        entityType: 'ClubMembership',
        entityId: row.id,
        outcome: 'SUCCESS',
        actorUserId: actor.id,
        before: { status: existing.status },
        after: { status: row.status },
      });
    });
  }

  /**
   * DELETE /clubs/:clubId/members/:userId. An officer's decision, distinct
   * from `leave`: the row lands on REMOVED, never LEFT, so the two stay
   * distinguishable in the historical record.
   */
  async remove(actor: { id: string }, clubId: string, userId: string): Promise<void> {
    return this.host.run(async () => {
      const club = await this.host.tx.club.findUnique({ where: { id: clubId } });
      if (!club) throw new NotFoundError('No such club.');
      assertAcceptsEdits(club.status);

      const existing = await this.host.tx.clubMembership.findFirst({
        where: { clubId, userId, status: { in: ['PENDING', 'ACTIVE'] } },
      });
      if (!existing) throw new NotFoundError('No such member.');

      const row = await this.host.tx.clubMembership.update({
        where: { id: existing.id },
        data: { status: 'REMOVED', decidedAt: new Date(), decidedById: actor.id },
      });

      await this.audit.record({
        action: 'club.membership_removed',
        entityType: 'ClubMembership',
        entityId: row.id,
        outcome: 'SUCCESS',
        actorUserId: actor.id,
        before: { status: existing.status },
        after: { status: row.status },
      });
    });
  }

  /** GET /clubs/:clubId/members. Same cursor pattern as ClubsService.list and TeamService.list. */
  async members(clubId: string, query: MemberListQuery): Promise<MemberPage> {
    const where: Prisma.ClubMembershipWhereInput = {
      clubId,
      ...(query.status ? { status: query.status } : {}),
    };

    const rows = await this.host.tx.clubMembership.findMany({
      where,
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      orderBy: { id: 'asc' },
      include: WITH_USER,
    });

    const hasMore = rows.length > query.limit;
    const items = hasMore ? rows.slice(0, query.limit) : rows;
    const roles = await this.rolesForMany(clubId, items.map((r) => r.userId));

    return {
      items: items.map((r) => toMember(r, roles.get(r.userId) ?? [])),
      nextCursor: hasMore ? items[items.length - 1]!.id : null,
    };
  }

  /**
   * GET /me/clubs. Self-scoped by `userId: actor.id`; no @RequirePermission.
   * Lists every club the caller has ever had a membership row in, whatever
   * its current status, so `status` on the wire shape is the record of
   * that history rather than only its currently-active slice.
   */
  async myClubs(actor: { id: string }, query: CursorPageQuery): Promise<MyClubPage> {
    const rows = await this.host.tx.clubMembership.findMany({
      where: { userId: actor.id },
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      orderBy: { id: 'asc' },
      include: { club: { select: { slug: true, name: true, logoUrl: true } } },
    });

    const hasMore = rows.length > query.limit;
    const items = hasMore ? rows.slice(0, query.limit) : rows;
    const roles = await this.rolesForUserAcrossClubs(actor.id, items.map((r) => r.clubId));

    return {
      items: items.map((r) => ({
        clubId: r.clubId,
        slug: r.club.slug,
        name: r.club.name,
        logoUrl: r.club.logoUrl,
        status: r.status,
        clubRoles: roles.get(r.clubId) ?? [],
      })),
      nextCursor: hasMore ? items[items.length - 1]!.id : null,
    };
  }
}
