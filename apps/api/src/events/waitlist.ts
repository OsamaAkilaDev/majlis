import type { AuditService } from '../audit/audit.service';
import type { NotificationService } from '../notifications/notification.service';
import type { TransactionHost } from '../prisma/transaction.host';

/**
 * Promotes up to `seats` students off the head of the waitlist, in the caller's
 * transaction. Spec 5.2: `FOR UPDATE SKIP LOCKED` hides a picked row from a
 * concurrent promoter rather than making it wait and promote the same student
 * twice. Callers hold the event row lock, so the increment cannot race.
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
  // The position must be cleared: a non-null value reads as "waitlisted" in
  // eventDetail's viewerWaitlistPosition and on the roster.
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

  // Spec 7.7. Same transaction as the promotion, so a rolled-back promotion
  // cannot leave somebody told they have a seat.
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
