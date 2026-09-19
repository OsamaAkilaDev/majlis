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
import { AuditService } from '../audit/audit.service';
import type { PlatformRole } from '../auth/permissions';
import { assertAcceptsNewActivity } from '../clubs/club-status';
import { cursorArgs, cursorPage } from '../common/cursor-page';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnprocessableError,
} from '../common/problem/domain-error';
import { violatedConstraintName } from '../common/prisma-constraint';
import { Prisma, type EventRegistration as RegistrationRow } from '../generated/prisma/client';
import { TransactionHost } from '../prisma/transaction.host';
import { EventLifecycleService } from './event-lifecycle.service';
import { NotificationService } from '../notifications/notification.service';
import { EVENT_SUMMARY_SELECT, toEventSummary } from './events.service';
import { promoteFromWaitlist } from './waitlist';

const WITH_USER = { user: { select: { fullName: true, email: true } } } as const;

// Statuses that still hold a place.
const OPEN = { status: { not: 'CANCELLED' } } as const;

interface Actor {
  id: string;
  platformRole: PlatformRole;
  fullName: string;
  email: string;
}

interface Person {
  fullName: string;
  email: string;
}

// The columns the row lock reads. The club's status rides along on the same
// statement: it is needed under the lock, and a second round trip there holds
// the event row longer.
interface LockedEvent {
  id: string;
  clubId: string;
  title: string;
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
    private readonly notifications: NotificationService,
  ) {}

  /**
   * Spec 7.4's last seat, in one transaction. The event row lock is what makes
   * two simultaneous requests for one seat produce exactly one CONFIRMED:
   * without it both read the same confirmed_count, both find room, and the event
   * oversells until the CHECK constraint happens to catch one.
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

    // Nothing that only shapes the response happens under the event row lock:
    // the attendee's name and email are resolved after the commit.
    try {
      const row = await this.host.run(async () => {
        const event = await this.lockEvent(eventId);

        // Registering twice is idempotent (spec 8), so this precedes the window
        // checks: someone who already holds a place gets it back rather than a
        // refusal for a window that has since closed.
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

        // Spec 7.7. Same transaction as the seat: a rolled-back registration
        // must not leave a notification for a place nobody holds.
        await this.notifications.record({
          userId,
          type: seatFree ? 'registration.confirmed' : 'registration.waitlisted',
          subject: row.id,
          payload: {
            registrationId: row.id,
            eventId,
            eventTitle: event.title,
            status: row.status,
            waitlistPosition: row.waitlistPosition,
          },
        });

        return row;
      });

      return toRegistration(row, await this.person(actor, userId));
    } catch (e) {
      // event_registration_one_open_per_user. The check under the row lock
      // short-circuits the normal case, so reaching here means the index caught
      // what the lock did not: answer the same way, with the row that won.
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

  // SessionGuard already loaded the actor's row, so only an Admin override
  // costs a query here.
  private async person(actor: Actor, userId: string): Promise<Person> {
    if (userId === actor.id) return { fullName: actor.fullName, email: actor.email };
    return this.host.tx.user.findUniqueOrThrow({
      where: { id: userId },
      select: { fullName: true, email: true },
    });
  }

  // Sets CANCELLED, never deletes. Decrement and waitlist promotion happen in
  // the same transaction (spec 7.4).
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

      // Only a confirmed seat frees a seat. Cancelling from the waitlist frees
      // nothing, and promoting on it would push the event over capacity.
      if (existing.status === 'CONFIRMED') {
        await this.host.tx.event.update({
          where: { id: eventId },
          data: { confirmedCount: { decrement: 1 } },
        });
        // A cancelled event has no seats to promote anyone into. The counter
        // still comes down: it is the record of who held a place.
        if (event.status !== 'CANCELLED') {
          await promoteFromWaitlist(this.host, this.audit, this.notifications, eventId, 1);
        }
      }
    });
  }

  async roster(eventId: string, query: RegistrationListQuery): Promise<RegistrationPage> {
    const rows = await this.host.tx.eventRegistration.findMany({
      where: { eventId, ...(query.status ? { status: query.status } : {}) },
      ...cursorArgs(query),
      include: WITH_USER,
    });

    const { items, nextCursor } = cursorPage(rows, query.limit);

    return {
      items: items.map((row) => toRegistration(row, row.user)),
      nextCursor,
    };
  }

  // Self-scoped by `userId: actor.id`, which is why the route carries no
  // @RequirePermission. Cancelled rows are excluded: this lists places held.
  async mine(actor: Actor, query: CursorPageQuery): Promise<MyRegistrationPage> {
    const rows = await this.host.tx.eventRegistration.findMany({
      where: { userId: actor.id, ...OPEN },
      ...cursorArgs(query),
      include: { event: { select: EVENT_SUMMARY_SELECT } },
    });

    const { items, nextCursor } = cursorPage(rows, query.limit);

    return {
      items: items.map((r) => ({
        id: r.id,
        status: r.status,
        waitlistPosition: r.waitlistPosition,
        registeredAt: r.registeredAt.toISOString(),
        event: toEventSummary(r.event),
      })),
      nextCursor,
    };
  }

  /**
   * `SELECT … FOR UPDATE` on the event row. Every registration write serialises
   * here, which is what keeps the seat count, the waitlist position and the
   * counter consistent under concurrency.
   */
  private async lockEvent(eventId: string): Promise<LockedEvent> {
    const rows = await this.host.tx.$queryRaw<LockedEvent[]>`
      SELECT e."id",
             e."club_id" AS "clubId",
             e."title",
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
    // A draft is not visible outside the club team, so it must be
    // indistinguishable from an event that does not exist.
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

  // No `include`: Prisma issues the relation query even when the parent matches
  // nothing, costing a second round trip on the common path to fetch nobody.
  private async findOpen(eventId: string, userId: string): Promise<RegistrationRow | null> {
    return this.host.tx.eventRegistration.findFirst({ where: { eventId, userId, ...OPEN } });
  }

  // Assigned under the event row lock, which is what keeps the queue order stable.
  private async nextWaitlistPosition(eventId: string): Promise<number> {
    const { _max } = await this.host.tx.eventRegistration.aggregate({
      _max: { waitlistPosition: true },
      where: { eventId, status: 'WAITLISTED' },
    });
    return (_max.waitlistPosition ?? 0) + 1;
  }
}
