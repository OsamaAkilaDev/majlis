import { Injectable } from '@nestjs/common';
import type {
  Appointment,
  AppointLeadBody,
  AppointmentPage,
  CursorPageQuery,
  EndAppointmentBody,
  Invitation,
  InvitationPage,
  InviteTeamMemberBody,
} from '@majlis/contracts';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- value import: Nest DI resolves this from design:paramtypes.
import { AuditService } from '../../audit/audit.service';
import { clubOverrideReason } from '../../auth/override';
import type { PlatformRole } from '../../auth/permissions';
import { cursorArgs, cursorPage } from '../../common/cursor-page';
import { ConflictError, NotFoundError, UnprocessableError } from '../../common/problem/domain-error';
import { conflictOn } from '../../common/prisma-constraint';
import type { ClubTeamAppointment as AppointmentRow } from '../../generated/prisma/client';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- must stay a value import: Nest's constructor DI resolves this provider from the emitted `design:paramtypes` metadata, which needs a real runtime reference.
import { TransactionHost } from '../../prisma/transaction.host';
import { assertCanReadRoster } from '../roster-access';
import { assertAcceptsEdits } from '../club-status';
import { loadClub } from '../load-club';

const INVITATION_TTL_DAYS = 14;
const WITH_USER = { user: { select: { fullName: true, email: true } } } as const;
const WITH_CLUB = { club: { select: { name: true, logoUrl: true } } } as const;

type AppointmentWithUser = AppointmentRow & { user: { fullName: string; email: string } };
type InvitationRow = AppointmentRow & { club: { name: string; logoUrl: string } };

/**
 * The transaction body's own return type, discriminating "flipped to EXPIRED"
 * from "accepted" so `accept` can throw outside `host.run` once the caller
 * sees this. Throwing inside the transaction that just wrote EXPIRED would
 * roll that write back, and the invitation would expire again on every
 * subsequent attempt, forever. Shared by accept and decline.
 */
type InvitationOutcome = { kind: 'expired' } | { kind: 'ok'; appointment: Appointment };

function invitationExpiresAt(): Date {
  return new Date(Date.now() + INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000);
}

/** Maps an INVITED row plus its club onto the wire shape for /me/invitations. */
function toInvitation(row: InvitationRow): Invitation {
  return {
    id: row.id,
    clubId: row.clubId,
    clubName: row.club.name,
    clubLogoUrl: row.club.logoUrl,
    role: row.role,
    // invite/appointLead always set this; myInvitations' own WHERE clause
    // already excludes any row where it has passed.
    invitationExpiresAt: row.invitationExpiresAt!.toISOString(),
  };
}

/** Maps a row plus the caller-supplied membership fact onto the wire shape. */
function toAppointment(row: AppointmentWithUser, hasLeftClub: boolean): Appointment {
  return {
    id: row.id,
    clubId: row.clubId,
    userId: row.userId,
    userFullName: row.user.fullName,
    userEmail: row.user.email,
    role: row.role,
    status: row.status,
    invitationExpiresAt: row.invitationExpiresAt?.toISOString() ?? null,
    acceptedAt: row.acceptedAt?.toISOString() ?? null,
    endedAt: row.endedAt?.toISOString() ?? null,
    hasLeftClub,
  };
}

/**
 * The one-active-Lead partial index (club_team_appointment_one_active_lead)
 * is hand-written SQL, not a Prisma `@@unique`. Its name comes back through
 * `violatedConstraintName`, not `meta.target`: Prisma 7's pg driver adapter
 * never populates `meta.target` at all for a P2002, hand-written index or
 * not, and reports the constraint name at `meta.driverAdapterError.cause
 * .constraint.index` instead. Unreachable from Task 6 (appointLead/invite
 * only ever create INVITED rows, and the index only constrains ACTIVE
 * ones); this exists for Task 7's accept, which is the first path that can
 * produce the collision.
 */
const mapWriteError = conflictOn({ one_active_lead: 'That club already has an active Lead.' });

@Injectable()
export class TeamService {
  constructor(
    private readonly host: TransactionHost,
    private readonly audit: AuditService,
  ) {}

  /** Whether `userId` currently holds no ACTIVE ClubMembership in `clubId`. */
  private async hasLeftClub(clubId: string, userId: string): Promise<boolean> {
    const membership = await this.host.tx.clubMembership.findFirst({
      where: { clubId, userId, status: 'ACTIVE' },
    });
    return !membership;
  }

  /** POST /clubs/:clubId/lead. Admin only; the nominee holds no authority until they accept. */
  async appointLead(actor: { id: string }, clubId: string, body: AppointLeadBody): Promise<Appointment> {
    return this.host.run(async () => {
      await loadClub(this.host, clubId, assertAcceptsEdits);
      if (body.userId === actor.id) throw new UnprocessableError('You cannot appoint yourself.');

      const row = await this.host.tx.clubTeamAppointment
        .create({
          data: {
            clubId,
            userId: body.userId,
            role: 'LEAD',
            status: 'INVITED',
            invitedById: actor.id,
            invitationExpiresAt: invitationExpiresAt(),
          },
          include: WITH_USER,
        })
        .catch(mapWriteError);

      await this.audit.record({
        action: 'club.lead_invited',
        entityType: 'ClubTeamAppointment',
        entityId: row.id,
        outcome: 'SUCCESS',
        actorUserId: actor.id,
        after: { clubId, userId: row.userId, role: row.role },
      });

      return toAppointment(row, await this.hasLeftClub(clubId, row.userId));
    });
  }

  /** POST /clubs/:clubId/team. Lead only; role is any of the four non-Lead values. */
  async invite(
    actor: { id: string; platformRole: PlatformRole },
    clubId: string,
    body: InviteTeamMemberBody,
  ): Promise<Appointment> {
    return this.host.run(async () => {
      await loadClub(this.host, clubId, assertAcceptsEdits);
      if (body.userId === actor.id) throw new UnprocessableError('You cannot invite yourself.');
      const reason = await clubOverrideReason(this.host, actor, clubId, body.overrideReason);

      const existing = await this.host.tx.clubTeamAppointment.findFirst({
        where: { clubId, userId: body.userId, role: body.role, status: 'ACTIVE' },
      });
      if (existing) throw new ConflictError('That user already holds that role.');

      const row = await this.host.tx.clubTeamAppointment
        .create({
          data: {
            clubId,
            userId: body.userId,
            role: body.role,
            status: 'INVITED',
            invitedById: actor.id,
            invitationExpiresAt: invitationExpiresAt(),
          },
          include: WITH_USER,
        })
        .catch(mapWriteError);

      await this.audit.record({
        action: 'club.officer_invited',
        entityType: 'ClubTeamAppointment',
        entityId: row.id,
        outcome: 'SUCCESS',
        actorUserId: actor.id,
        ...(reason ? { reason } : {}),
        after: { clubId, userId: row.userId, role: row.role },
      });

      return toAppointment(row, await this.hasLeftClub(clubId, row.userId));
    });
  }

  /**
   * DELETE /clubs/:clubId/team/:appointmentId. Scoping the read to
   * `{ id: appointmentId, clubId }` is what makes an appointment from
   * another club a plain 404 rather than a cross-club write.
   */
  async end(actor: { id: string }, clubId: string, appointmentId: string, body: EndAppointmentBody): Promise<void> {
    return this.host.run(async () => {
      const appointment = await this.host.tx.clubTeamAppointment.findFirst({
        where: { id: appointmentId, clubId },
      });
      if (!appointment) throw new NotFoundError('No such appointment.');
      if (appointment.userId === actor.id) throw new UnprocessableError('You cannot end your own appointment.');
      if (appointment.status !== 'ACTIVE') throw new UnprocessableError('That appointment is not active.');

      const after = await this.host.tx.clubTeamAppointment.update({
        where: { id: appointmentId },
        data: { status: 'ENDED', endedAt: new Date(), endedReason: body.reason },
      });

      await this.audit.record({
        action: 'club.appointment_ended',
        entityType: 'ClubTeamAppointment',
        entityId: appointment.id,
        outcome: 'SUCCESS',
        reason: body.reason,
        actorUserId: actor.id,
        before: { status: appointment.status },
        after: { status: after.status },
      });
    });
  }

  /** GET /clubs/:clubId/team. Same cursor pattern as ClubsService.list. */
  async list(actor: { id: string; platformRole: string }, clubId: string, query: CursorPageQuery): Promise<AppointmentPage> {
    await assertCanReadRoster(this.host, actor, clubId);

    const rows = await this.host.tx.clubTeamAppointment.findMany({
      where: { clubId },
      ...cursorArgs(query),
      include: WITH_USER,
    });

    const { items, nextCursor } = cursorPage(rows, query.limit);

    // One batched membership lookup for the whole page rather than one query
    // per row, which is what an N+1 read would otherwise cost here.
    const activeMemberships = await this.host.tx.clubMembership.findMany({
      where: { clubId, userId: { in: items.map((r) => r.userId) }, status: 'ACTIVE' },
      select: { userId: true },
    });
    const activeUserIds = new Set(activeMemberships.map((m) => m.userId));

    return {
      items: items.map((r) => toAppointment(r, !activeUserIds.has(r.userId))),
      nextCursor,
    };
  }

  /**
   * GET /me/invitations. No @RequirePermission: the `userId: actor.id` filter
   * below is the entire authorization, and expiry is filtered in the WHERE
   * clause (not after the fetch) so a lapsed invitation never surfaces here,
   * matching the main spec's "no queue, the lifecycle is lazy" decision.
   *
   * Both write paths (invite, appointLead) always set invitationExpiresAt, so
   * an invitation always has an expiry; this only matches non-expired ones.
   * A null-expiry row (unreachable today, but the column is nullable)
   * therefore never surfaces here rather than reaching toInvitation's
   * non-null assertion.
   */
  async myInvitations(actor: { id: string }, query: CursorPageQuery): Promise<InvitationPage> {
    const rows = await this.host.tx.clubTeamAppointment.findMany({
      where: {
        userId: actor.id,
        status: 'INVITED',
        invitationExpiresAt: { gt: new Date() },
      },
      ...cursorArgs(query),
      include: WITH_CLUB,
    });

    const { items, nextCursor } = cursorPage(rows, query.limit);

    return {
      items: items.map(toInvitation),
      nextCursor,
    };
  }

  /**
   * POST /appointments/:appointmentId/accept. Scoped to the actor, so an
   * appointment belonging to someone else is not found rather than
   * forbidden. This route carries no @RequirePermission at all.
   *
   * Expiry is evaluated here, on read, rather than by a job (spec: "no
   * queue, the lifecycle is lazy"). An invitation past its date is flipped
   * to EXPIRED opportunistically. That write must survive even though the
   * request still fails, so the transaction returns a discriminated result
   * instead of throwing for the expired case, and the throw happens after
   * `host.run` returns.
   */
  async accept(actor: { id: string }, appointmentId: string): Promise<Appointment> {
    const outcome = await this.host.run(async (): Promise<InvitationOutcome> => {
      const appt = await this.host.tx.clubTeamAppointment.findFirst({
        where: { id: appointmentId, userId: actor.id },
      });
      if (!appt) throw new NotFoundError('No such invitation.');
      if (appt.status !== 'INVITED') throw new UnprocessableError('That invitation is no longer open.');

      if (appt.invitationExpiresAt && appt.invitationExpiresAt.getTime() < Date.now()) {
        await this.host.tx.clubTeamAppointment.update({
          where: { id: appt.id },
          data: { status: 'EXPIRED' },
        });
        return { kind: 'expired' };
      }

      const club = await this.host.tx.club.findUniqueOrThrow({ where: { id: appt.clubId } });
      assertAcceptsEdits(club.status);

      const activated = await this.host.tx.clubTeamAppointment
        .update({
          where: { id: appt.id },
          data: { status: 'ACTIVE', acceptedAt: new Date(), termStart: new Date() },
          include: WITH_USER,
        })
        .catch(mapWriteError);

      // Main spec 7.2: acceptance also grants ordinary club membership.
      // Conditional, because the partial unique index forbids a second open
      // membership and an officer may already be one.
      const open = await this.host.tx.clubMembership.findFirst({
        where: { clubId: appt.clubId, userId: actor.id, status: { in: ['PENDING', 'ACTIVE'] } },
      });
      if (!open) {
        await this.host.tx.clubMembership.create({
          data: { clubId: appt.clubId, userId: actor.id, status: 'ACTIVE' },
        });
      } else if (open.status === 'PENDING') {
        await this.host.tx.clubMembership.update({
          where: { id: open.id },
          data: { status: 'ACTIVE', decidedAt: new Date(), decidedById: actor.id },
        });
      }

      await this.audit.record({
        action: 'club.appointment_accepted',
        entityType: 'ClubTeamAppointment',
        entityId: appt.id,
        outcome: 'SUCCESS',
        actorUserId: actor.id,
        before: { status: appt.status },
        after: { status: 'ACTIVE' },
      });

      return { kind: 'ok', appointment: toAppointment(activated, await this.hasLeftClub(appt.clubId, actor.id)) };
    });

    if (outcome.kind === 'expired') throw new UnprocessableError('That invitation has expired.');
    return outcome.appointment;
  }

  /**
   * POST /appointments/:appointmentId/decline. Same expiry handling as
   * accept, minus the membership branch: declining grants nothing.
   */
  async decline(actor: { id: string }, appointmentId: string): Promise<Appointment> {
    const outcome = await this.host.run(async (): Promise<InvitationOutcome> => {
      const appt = await this.host.tx.clubTeamAppointment.findFirst({
        where: { id: appointmentId, userId: actor.id },
      });
      if (!appt) throw new NotFoundError('No such invitation.');
      if (appt.status !== 'INVITED') throw new UnprocessableError('That invitation is no longer open.');

      if (appt.invitationExpiresAt && appt.invitationExpiresAt.getTime() < Date.now()) {
        await this.host.tx.clubTeamAppointment.update({
          where: { id: appt.id },
          data: { status: 'EXPIRED' },
        });
        return { kind: 'expired' };
      }

      const declined = await this.host.tx.clubTeamAppointment.update({
        where: { id: appt.id },
        data: { status: 'DECLINED' },
        include: WITH_USER,
      });

      await this.audit.record({
        action: 'club.appointment_declined',
        entityType: 'ClubTeamAppointment',
        entityId: appt.id,
        outcome: 'SUCCESS',
        actorUserId: actor.id,
        before: { status: appt.status },
        after: { status: 'DECLINED' },
      });

      return { kind: 'ok', appointment: toAppointment(declined, await this.hasLeftClub(appt.clubId, actor.id)) };
    });

    if (outcome.kind === 'expired') throw new UnprocessableError('That invitation has expired.');
    return outcome.appointment;
  }
}
