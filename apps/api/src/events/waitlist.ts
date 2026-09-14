import type { AuditService } from '../audit/audit.service';
import type { NotificationService } from '../notifications/notification.service';
import type { TransactionHost } from '../prisma/transaction.host';

/**
 * Promotes up to `seats` students off the head of an event's waitlist,
 * inside the caller's transaction.
 *
 * A free function rather than a service so both callers (a cancellation
 * freeing a seat, and a capacity rise creating several) reach the same code
 * without one service having to inject the other.
 *
 * `FOR UPDATE SKIP LOCKED` over `ORDER BY waitlist_position` is spec 5.2's
 * mechanism: the lock makes a row this transaction picked invisible to a
 * concurrent promoter rather than making that promoter wait and then promote
 * the same student twice.
 *
 * Callers hold the event row lock, so the counter increment here cannot race
 * a registration. Returns the number actually promoted, which is what the
 * caller adds to `confirmed_count`.
 */
export async function promoteFromWaitlist(
  host: TransactionHost,
  audit: AuditService,
  notifications: NotificationService,
  eventId: string,
  seats: number,
): Promise<number> {
  if (seats <= 0) return 0;

  const queued = await host.tx.$queryRaw<{ id: string; user_id: string }[]>`
    SELECT "id", "user_id" FROM "event_registration"
    WHERE "event_id" = ${eventId}::uuid AND "status" = 'WAITLISTED'
    ORDER BY "waitlist_position" ASC
    LIMIT ${seats}
    FOR UPDATE SKIP LOCKED`;

  if (queued.length === 0) return 0;

  const promotedAt = new Date();
  // The position is cleared, not kept: it travels into eventDetail's
  // viewerWaitlistPosition and the roster, where a non-null value reads as
  // "this person is waitlisted" beside a Confirmed badge.
  await host.tx.eventRegistration.updateMany({
    where: { id: { in: queued.map((r) => r.id) } },
    data: { status: 'CONFIRMED', promotedAt, waitlistPosition: null },
  });

  for (const row of queued) {
    await audit.record({
      action: 'event.registration_promoted',
      entityType: 'EventRegistration',
      entityId: row.id,
      outcome: 'SUCCESS',
      before: { status: 'WAITLISTED' },
      after: { status: 'CONFIRMED', userId: row.user_id, eventId },
    });
  }

  // Spec 7.7, waitlist promotion. Same transaction as the promotion itself,
  // so a rolled-back promotion cannot leave somebody told they have a seat.
  const { title } = await host.tx.event.findUniqueOrThrow({
    where: { id: eventId },
    select: { title: true },
  });
  await notifications.recordMany(
    queued.map((row) => ({
      userId: row.user_id,
      type: 'registration.promoted' as const,
      subject: row.id,
      payload: { registrationId: row.id, eventId, eventTitle: title, status: 'CONFIRMED' },
    })),
  );

  await host.tx.event.update({
    where: { id: eventId },
    data: { confirmedCount: { increment: queued.length } },
  });

  return queued.length;
}
