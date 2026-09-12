import { Injectable } from '@nestjs/common';
import type {
  ClubStatus,
  CursorPageQuery,
  EventStatus,
  MyRegistrationPage,
  RegisterBody,
  Registration,
  RegistrationListQuery,
  RegistrationPage,
} from '@majlis/contracts';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- value import: Nest DI resolves this from design:paramtypes.
import { AuditService } from '../audit/audit.service';
import type { PlatformRole } from '../auth/permissions';
import { assertAcceptsNewActivity } from '../clubs/club-status';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnprocessableError,
} from '../common/problem/domain-error';
import { violatedConstraintName } from '../common/prisma-constraint';
import { Prisma, type EventRegistration as RegistrationRow } from '../generated/prisma/client';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- value import: see above.
import { TransactionHost } from '../prisma/transaction.host';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- value import: see above.
import { EventLifecycleService } from './event-lifecycle.service';
import { EVENT_SUMMARY_SELECT, toEventSummary } from './events.service';
import { promoteFromWaitlist } from './waitlist';

const WITH_USER = { user: { select: { fullName: true, email: true } } } as const;
type RegistrationWithUser = RegistrationRow & { user: { fullName: string; email: string } };

/** Statuses that still hold a place: everything except a cancellation. */
const OPEN = { status: { not: 'CANCELLED' } } as const;

interface Actor {
  id: string;
  platformRole: PlatformRole;
  fullName: string;
  email: string;
}

/** The two person fields a Registration carries beyond the row itself. */
interface Person {
  fullName: string;
  email: string;
}

/**
 * The columns the row lock reads, aliased out of their snake_case names.
 * The club's status rides along on the same statement: it is needed under
 * the lock, and a second round trip there holds the event row longer.
 */
interface LockedEvent {
  id: string;
  clubId: string;
  clubStatus: ClubStatus;
  status: EventStatus;
  capacity: number;
  confirmedCount: number;
  waitlistEnabled: boolean;
  requiresClubMembership: boolean;
  registrationOpensAt: Date;
  registrationClosesAt: Date;
}

function toRegistration(row: RegistrationRow, person: Person): Registration {
  return {
    id: row.id,
    eventId: row.eventId,
    userId: row.userId,
    userFullName: person.fullName,
    userEmail: person.email,
    status: row.status,
    waitlistPosition: row.waitlistPosition,
    registeredAt: row.registeredAt.toISOString(),
    promotedAt: row.promotedAt?.toISOString() ?? null,
    source: row.source,
  };
}

@Injectable()
export class RegistrationsService {
  constructor(
    private readonly host: TransactionHost,
    private readonly audit: AuditService,
    private readonly lifecycle: EventLifecycleService,
  ) {}

  /**
   * POST /events/:eventId/registrations. Spec 7.4's last seat, in one
   * transaction: lock the event row, re-check status, window and eligibility,
   * then confirm or waitlist, maintain the counter, audit, commit.
   *
   * The row lock is what makes two simultaneous requests for one seat produce
   * exactly one CONFIRMED. Without it both read the same confirmed_count,
   * both find room, and the event oversells until the CHECK constraint
   * happens to catch one of them.
   */
  async register(actor: Actor, eventId: string, body: RegisterBody): Promise<Registration> {
    const override = body.userId !== undefined;
    if (override && actor.platformRole !== 'ADMIN') {
      throw new ForbiddenError('Only an administrator may register someone else.');
    }
    const userId = body.userId ?? actor.id;

    // Its own transaction, before ours: every refusal below rolls back the
    // transaction it is thrown in, and the advance must survive that.
    await this.lifecycle.advance(eventId);

    // Nothing that only shapes the RESPONSE happens under the event row
    // lock: the transaction returns the row, and the attendee's name and
    // email are resolved after it has committed.
    try {
      const row = await this.host.run(async () => {
        const event = await this.lockEvent(eventId);

        // Registering twice is idempotent (spec 8), so this precedes the
        // window checks: someone who already holds a place gets it back
        // rather than a refusal for a window that has since closed.
        const existing = await this.findOpen(eventId, userId);
        if (existing) return existing;

        this.assertOpenForRegistration(event);
        assertAcceptsNewActivity(event.clubStatus);

        // An override skips ONLY eligibility (spec 7.4). It never skips the
        // capacity lock: an Admin cannot conjure a seat that does not exist.
        if (!override && event.requiresClubMembership) {
          const membership = await this.host.tx.clubMembership.findFirst({
            where: { clubId: event.clubId, userId, status: 'ACTIVE' },
          });
          if (!membership) {
            throw new UnprocessableError('You must be a member of that club to register for this event.');
          }
        }

        const seatFree = event.confirmedCount < event.capacity;
        if (!seatFree && !event.waitlistEnabled) {
          throw new ConflictError('That event is full and has no waitlist.');
        }

        const row = await this.host.tx.eventRegistration.create({
          data: {
            eventId,
            userId,
            status: seatFree ? 'CONFIRMED' : 'WAITLISTED',
            waitlistPosition: seatFree ? null : await this.nextWaitlistPosition(eventId),
            source: override ? 'ADMIN_OVERRIDE' : 'SELF',
            overrideReason: body.overrideReason ?? null,
          },
        });

        if (seatFree) {
          await this.host.tx.event.update({
            where: { id: eventId },
            data: { confirmedCount: { increment: 1 } },
          });
        }

        await this.audit.record({
          action: override ? 'event.registration_overridden' : 'event.registered',
          entityType: 'EventRegistration',
          entityId: row.id,
          outcome: 'SUCCESS',
          reason: body.overrideReason,
          actorUserId: actor.id,
          after: { eventId, userId, status: row.status, waitlistPosition: row.waitlistPosition },
        });

        return row;
      });

      return toRegistration(row, await this.person(actor, userId));
    } catch (e) {
      // event_registration_one_open_per_user. The check above already
      // short-circuits under the row lock, so reaching here means the index
      // caught something that lock did not: answer it the same way, with the
      // row that won.
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002' &&
        violatedConstraintName(e.meta).includes('one_open_per_user')
      ) {
        const existing = await this.findOpen(eventId, userId);
        if (existing) return toRegistration(existing, await this.person(actor, userId));
      }
      throw e;
    }
  }

  /**
   * The attendee's name and email for the response. Self-registration is the
   * common case and SessionGuard already loaded that row for this request,
   * so only an Admin override costs a query.
   */
  private async person(actor: Actor, userId: string): Promise<Person> {
    if (userId === actor.id) return { fullName: actor.fullName, email: actor.email };
    return this.host.tx.user.findUniqueOrThrow({
      where: { id: userId },
      select: { fullName: true, email: true },
    });
  }

  /**
   * DELETE /events/:eventId/registrations/me. Sets CANCELLED, never deletes,
   * decrements the counter and promotes the head of the waitlist in the same
   * transaction (spec 7.4).
   */
  async cancel(actor: Actor, eventId: string): Promise<void> {
    await this.lifecycle.advance(eventId);

    return this.host.run(async () => {
      const event = await this.lockEvent(eventId);
      if (!['PUBLISHED', 'REGISTRATION_CLOSED', 'CANCELLED'].includes(event.status)) {
        throw new UnprocessableError('That event no longer accepts registration changes.');
      }

      const existing = await this.host.tx.eventRegistration.findFirst({
        where: { eventId, userId: actor.id, status: { in: ['CONFIRMED', 'WAITLISTED'] } },
      });
      if (!existing) throw new NotFoundError('You are not registered for that event.');

      await this.host.tx.eventRegistration.update({
        where: { id: existing.id },
        data: { status: 'CANCELLED', cancelledAt: new Date(), cancelledById: actor.id },
      });

      await this.audit.record({
        action: 'event.registration_cancelled',
        entityType: 'EventRegistration',
        entityId: existing.id,
        outcome: 'SUCCESS',
        actorUserId: actor.id,
        before: { status: existing.status },
        after: { status: 'CANCELLED' },
      });

      // Only a confirmed seat frees a seat. Cancelling from the waitlist
      // frees nothing, and promoting on it would push the event over
      // capacity.
      if (existing.status === 'CONFIRMED') {
        await this.host.tx.event.update({
          where: { id: eventId },
          data: { confirmedCount: { decrement: 1 } },
        });
        await promoteFromWaitlist(this.host, this.audit, eventId, 1);
      }
    });
  }

  /** GET /events/:eventId/registrations. Attendee personal data, behind `registration:read`. */
  async roster(eventId: string, query: RegistrationListQuery): Promise<RegistrationPage> {
    const rows = await this.host.tx.eventRegistration.findMany({
      where: { eventId, ...(query.status ? { status: query.status } : {}) },
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      orderBy: { id: 'asc' },
      include: WITH_USER,
    });

    const hasMore = rows.length > query.limit;
    const items = hasMore ? rows.slice(0, query.limit) : rows;

    return {
      items: items.map((row) => toRegistration(row, row.user)),
      nextCursor: hasMore ? items[items.length - 1]!.id : null,
    };
  }

  /**
   * GET /me/registrations. Self-scoped by `userId: actor.id`; no
   * @RequirePermission, and cancelled rows are excluded so a student's list
   * shows the places they hold, not everything they ever clicked.
   */
  async mine(actor: Actor, query: CursorPageQuery): Promise<MyRegistrationPage> {
    const rows = await this.host.tx.eventRegistration.findMany({
      where: { userId: actor.id, ...OPEN },
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      orderBy: { id: 'asc' },
      include: { event: { select: EVENT_SUMMARY_SELECT } },
    });

    const hasMore = rows.length > query.limit;
    const items = hasMore ? rows.slice(0, query.limit) : rows;

    return {
      items: items.map((r) => ({
        id: r.id,
        status: r.status,
        waitlistPosition: r.waitlistPosition,
        registeredAt: r.registeredAt.toISOString(),
        event: toEventSummary(r.event),
      })),
      nextCursor: hasMore ? items[items.length - 1]!.id : null,
    };
  }

  /**
   * `SELECT … FOR UPDATE` on the event row. Every registration write on an
   * event serialises here, which is what makes the seat count, the waitlist
   * position and the counter consistent under concurrency.
   */
  private async lockEvent(eventId: string): Promise<LockedEvent> {
    const rows = await this.host.tx.$queryRaw<LockedEvent[]>`
      SELECT e."id",
             e."club_id" AS "clubId",
             e."status"::text AS "status",
             e."capacity",
             e."confirmed_count" AS "confirmedCount",
             e."waitlist_enabled" AS "waitlistEnabled",
             e."requires_club_membership" AS "requiresClubMembership",
             e."registration_opens_at" AS "registrationOpensAt",
             e."registration_closes_at" AS "registrationClosesAt",
             c."status"::text AS "clubStatus"
      FROM "event" e JOIN "club" c ON c."id" = e."club_id"
      WHERE e."id" = ${eventId}::uuid
      FOR UPDATE OF e`;

    const event = rows[0];
    if (!event) throw new NotFoundError('No such event.');
    return event;
  }

  private assertOpenForRegistration(event: LockedEvent): void {
    // A draft is not visible outside the club team, so it must not be
    // distinguishable from an event that does not exist.
    if (event.status === 'DRAFT') throw new NotFoundError('No such event.');
    if (event.status === 'CANCELLED') throw new UnprocessableError('That event was cancelled.');
    if (event.status !== 'PUBLISHED') {
      throw new UnprocessableError('Registration for that event has closed.');
    }

    const now = new Date();
    if (now < event.registrationOpensAt) {
      throw new UnprocessableError('Registration for that event has not opened yet.');
    }
    if (now >= event.registrationClosesAt) {
      throw new UnprocessableError('Registration for that event has closed.');
    }
  }

  private async findOpen(eventId: string, userId: string): Promise<RegistrationWithUser | null> {
    return this.host.tx.eventRegistration.findFirst({
      where: { eventId, userId, ...OPEN },
      include: WITH_USER,
    });
  }

  /** Assigned under the event row lock, which is what keeps the queue order stable. */
  private async nextWaitlistPosition(eventId: string): Promise<number> {
    const { _max } = await this.host.tx.eventRegistration.aggregate({
      _max: { waitlistPosition: true },
      where: { eventId, status: 'WAITLISTED' },
    });
    return (_max.waitlistPosition ?? 0) + 1;
  }
}
