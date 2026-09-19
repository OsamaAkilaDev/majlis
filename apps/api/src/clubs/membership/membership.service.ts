import { Injectable } from '@nestjs/common';
import type {
  AddMemberBody,
  CursorPageQuery,
  DecideMembershipBody,
  Member,
  MemberListQuery,
  MemberPage,
  MyClubPage,
  RemoveMemberBody,
} from '@majlis/contracts';
import { AuditService } from '../../audit/audit.service';
import { clubOverrideReason } from '../../auth/override';
import type { PlatformRole } from '../../auth/permissions';
import { cursorArgs, cursorPage } from '../../common/cursor-page';
import { NotFoundError, UnprocessableError } from '../../common/problem/domain-error';
import { conflictOn } from '../../common/prisma-constraint';
import type { ClubRole } from '../../generated/prisma/enums';
import type { Prisma, ClubMembership as MembershipRow } from '../../generated/prisma/client';
import { TransactionHost } from '../../prisma/transaction.host';
import { assertCanReadRoster, canReadRosterEmail, type RosterReader } from '../roster-access';
import { assertAcceptsEdits, assertAcceptsNewActivity } from '../club-status';
import { loadClub } from '../load-club';
import { NotificationService } from '../../notifications/notification.service';

const WITH_USER = { user: { select: { fullName: true, email: true } } } as const;
type MembershipWithUser = MembershipRow & { user: { fullName: string; email: string } };
interface AppointmentRoleRow {
  clubId: string;
  userId: string;
  role: ClubRole;
}

// `withEmail` defaults to true because every caller but the roster list is an
// officer-only write path that has already cleared `membership:decide`.
function toMember(row: MembershipWithUser, clubRoles: ClubRole[], withEmail = true): Member {
  return {
    id: row.id,
    userId: row.userId,
    userFullName: row.user.fullName,
    ...(withEmail ? { userEmail: row.user.email } : {}),
    status: row.status,
    requestedAt: row.requestedAt.toISOString(),
    decidedAt: row.decidedAt?.toISOString() ?? null,
    clubRoles,
  };
}

function groupRoles(rows: AppointmentRoleRow[], key: (r: AppointmentRoleRow) => string): Map<string, ClubRole[]> {
  const map = new Map<string, ClubRole[]>();
  for (const r of rows) map.set(key(r), [...(map.get(key(r)) ?? []), r.role]);
  return map;
}

// P2002 here is club_membership_one_open_per_user, a hand-written partial index
// rather than a Prisma `@@unique`. Applied to every write creating an open row.
const mapWriteError = conflictOn({
  one_open_per_user: 'You already have an open membership in that club.',
});

@Injectable()
export class MembershipService {
  constructor(
    private readonly host: TransactionHost,
    private readonly audit: AuditService,
    private readonly notifications: NotificationService,
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

  // Self-scoped: the row is always the actor's own, which is why the route
  // carries no @RequirePermission.
  async request(actor: { id: string }, clubId: string): Promise<Member> {
    return this.host.run(async () => {
      const club = await loadClub(this.host, clubId, assertAcceptsNewActivity);

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

  /**
   * The way in under INVITE_ONLY, and under OPEN and APPROVAL_REQUIRED too.
   * Refused under CLOSED: if an officer could add a member there, CLOSED and
   * INVITE_ONLY would behave identically and CLOSED would not be a policy.
   */
  async addMember(
    actor: { id: string; platformRole: PlatformRole },
    clubId: string,
    body: AddMemberBody,
  ): Promise<Member> {
    return this.host.run(async () => {
      const club = await loadClub(this.host, clubId, assertAcceptsNewActivity);
      if (club.membershipPolicy === 'CLOSED') throw new UnprocessableError('That club is closed to new members.');
      const reason = await clubOverrideReason(this.host, actor, clubId, body.overrideReason);

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
        ...(reason ? { reason } : {}),
        after: { clubId, userId: row.userId, status: row.status },
      });

      return toMember(row, await this.rolesFor(clubId, row.userId));
    });
  }

  /**
   * Scoping the read to `{ id: requestId, clubId }` is what makes a request from
   * another club a 404 rather than a cross-club decision (RULING D5).
   * `assertAcceptsEdits` allows this in a SUSPENDED club, the request already
   * being in flight, and refuses it in an ARCHIVED one.
   */
  async decide(actor: { id: string }, clubId: string, requestId: string, body: DecideMembershipBody): Promise<Member> {
    return this.host.run(async () => {
      const club = await loadClub(this.host, clubId, assertAcceptsEdits);

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

      // Spec 7.7. Approval and rejection both notify: a student waiting on an
      // answer needs to hear either one.
      await this.notifications.record({
        userId: row.userId,
        type: 'membership.decided',
        subject: row.id,
        payload: { membershipId: row.id, clubId, clubName: club.name, status: row.status },
      });

      return toMember(row, await this.rolesFor(clubId, row.userId));
    });
  }

  // Self-scoped: the caller leaves their own open membership.
  async leave(actor: { id: string }, clubId: string): Promise<void> {
    return this.host.run(async () => {
      await loadClub(this.host, clubId, assertAcceptsEdits);

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

  // An officer's decision, distinct from `leave`: the row lands on REMOVED,
  // never LEFT, so the two stay distinguishable in the record.
  async remove(
    actor: { id: string; platformRole: PlatformRole },
    clubId: string,
    userId: string,
    body: RemoveMemberBody,
  ): Promise<void> {
    return this.host.run(async () => {
      await loadClub(this.host, clubId, assertAcceptsEdits);

      const existing = await this.host.tx.clubMembership.findFirst({
        where: { clubId, userId, status: { in: ['PENDING', 'ACTIVE'] } },
      });
      if (!existing) throw new NotFoundError('No such member.');
      const reason = await clubOverrideReason(this.host, actor, clubId, body.overrideReason);

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
        ...(reason ? { reason } : {}),
        before: { status: existing.status },
        after: { status: row.status },
      });
    });
  }

  async members(actor: RosterReader, clubId: string, query: MemberListQuery): Promise<MemberPage> {
    await assertCanReadRoster(this.host, actor, clubId);
    // The route carries no @RequirePermission, the list being open to any
    // signed-in user, so this is the whole gate on the addresses in it.
    const withEmail = await canReadRosterEmail(this.host, actor, clubId, 'membership:decide');

    const where: Prisma.ClubMembershipWhereInput = {
      clubId,
      ...(query.status ? { status: query.status } : {}),
    };

    const rows = await this.host.tx.clubMembership.findMany({
      where,
      ...cursorArgs(query),
      include: WITH_USER,
    });

    const { items, nextCursor } = cursorPage(rows, query.limit);
    const roles = await this.rolesForMany(clubId, items.map((r) => r.userId));

    return {
      items: items.map((r) => toMember(r, roles.get(r.userId) ?? [], withEmail)),
      nextCursor,
    };
  }

  // Self-scoped by `userId: actor.id`, which is why the route carries no
  // @RequirePermission. PENDING/ACTIVE only: a club left and rejoined keeps its
  // LEFT row, and an unfiltered list would show that club twice.
  async myClubs(actor: { id: string }, query: CursorPageQuery): Promise<MyClubPage> {
    const rows = await this.host.tx.clubMembership.findMany({
      where: { userId: actor.id, status: { in: ['PENDING', 'ACTIVE'] } },
      ...cursorArgs(query),
      include: { club: { select: { slug: true, name: true, logoUrl: true } } },
    });

    const { items, nextCursor } = cursorPage(rows, query.limit);
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
      nextCursor,
    };
  }
}
