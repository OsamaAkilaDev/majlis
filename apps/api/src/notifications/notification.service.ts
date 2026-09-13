import { Inject, Injectable } from '@nestjs/common';
import type {
  Notification,
  NotificationListQuery,
  NotificationPage,
  NotificationSweepResult,
} from '@majlis/contracts';
import { cursorArgs, cursorPage } from '../common/cursor-page';
import { NotFoundError } from '../common/problem/domain-error';
import type { Prisma, Notification as NotificationRow } from '../generated/prisma/client';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- value import: Nest DI resolves this from design:paramtypes.
import { TransactionHost } from '../prisma/transaction.host';
import {
  NOTIFICATION_CHANNEL,
  type DeliverableNotification,
  type DeliveryOutcome,
  type NotificationChannel,
} from './notification-channel';
import { PASSWORD_RESET_TYPE, dedupeKeyFor, type NotificationEntry } from './notification-types';

/** A sweep that found more than this has a bigger problem than a slow run. */
const DELIVERY_SWEEP_LIMIT = 500;

function toNotification(row: NotificationRow): Notification {
  return {
    id: row.id,
    // The column is a plain string; the enum is the contract's. A row
    // written before a type was renamed would fail the response schema
    // rather than be silently reshaped here.
    type: row.type as Notification['type'],
    payload: (row.payload ?? {}) as Record<string, unknown>,
    readAt: row.readAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * The same shape as AuditService, and for the same reason: it writes through
 * `host.tx`, so a notification row enlists in whatever transaction the
 * caller opened. Spec 7.7 requires the row to be written in the same
 * transaction as the triggering action, and this is what makes that
 * structural rather than a rule every call site has to remember.
 *
 * Nothing here sends anything. `email_status` starts PENDING and delivery is
 * a separate, post-commit sweep, because a failed email must never roll back
 * the action that caused it, and anything sent inside the transaction can
 * do exactly that.
 */
@Injectable()
export class NotificationService {
  constructor(
    private readonly host: TransactionHost,
    @Inject(NOTIFICATION_CHANNEL) private readonly channel: NotificationChannel,
  ) {}

  record(entry: NotificationEntry): Promise<number> {
    return this.recordMany([entry]);
  }

  /**
   * `createMany({ skipDuplicates: true })` is `ON CONFLICT DO NOTHING` at the
   * database, which absorbs a repeat INSIDE the transaction. A bare P2002
   * could not be absorbed at all here: Postgres aborts the whole transaction
   * on a constraint violation, so catching it would only reach a connection
   * refusing every further statement. Same mechanism, and the same reason,
   * as certificate issuance.
   *
   * Returns how many rows were actually inserted, which is what the dedupe
   * tests assert on.
   */
  async recordMany(entries: NotificationEntry[]): Promise<number> {
    if (entries.length === 0) return 0;

    const { count } = await this.host.tx.notification.createMany({
      data: entries.map((e) => ({
        userId: e.userId,
        type: e.type,
        dedupeKey: dedupeKeyFor(e.type, e.subject),
        payload: e.payload as Prisma.InputJsonValue,
        ...(e.delivered
          ? { emailStatus: e.delivered.status, emailError: e.delivered.error ?? null }
          : {}),
      })),
      skipDuplicates: true,
    });
    return count;
  }

  /**
   * GET /me/notifications. Self-scoped by `userId`; there is no route that
   * lists another user's.
   *
   * `auth.password_reset` is excluded. Its payload carries a live reset link
   * (Task 3: there is no other way to reach it with email unwired), so it
   * is an email-only notification and not an inbox item. Leaving it in would
   * put a working credential into a JSON response that a browser caches, a
   * devtools network log keeps, and a screen share shows.
   */
  async list(actor: { id: string }, query: NotificationListQuery): Promise<NotificationPage> {
    const rows = await this.host.tx.notification.findMany({
      where: {
        userId: actor.id,
        type: { not: PASSWORD_RESET_TYPE },
        ...(query.unread === undefined ? {} : query.unread ? { readAt: null } : { readAt: { not: null } }),
      },
      ...cursorArgs(query),
    });

    const { items, nextCursor } = cursorPage(rows, query.limit);
    return { items: items.map(toNotification), nextCursor };
  }

  /**
   * POST /me/notifications/:id/read. Idempotent, and scoped to the actor, so
   * somebody else's notification is not found rather than forbidden, because the id
   * is a uuid the caller was never shown, and a 403 would confirm it exists.
   */
  async markRead(actor: { id: string }, id: string): Promise<Notification> {
    const row = await this.host.tx.notification.findFirst({
      where: { id, userId: actor.id, type: { not: PASSWORD_RESET_TYPE } },
    });
    if (!row) throw new NotFoundError('No such notification.');
    if (row.readAt) return toNotification(row);

    const read = await this.host.tx.notification.update({
      where: { id: row.id },
      data: { readAt: new Date() },
    });
    return toNotification(read);
  }

  /**
   * POST /internal/notification-sweep. Delivery is a sweep rather than a
   * fire-and-forget after each commit: the same three lines would otherwise
   * be scattered across ten call sites, and every notification whose process
   * died between commit and send would be lost. This is the pattern the
   * event lifecycle and certificate issuance already use, and it is
   * recoverable by construction. The cost is latency, accepted.
   *
   * PENDING is the only state picked up, so a FAILED row is attempted once
   * and never retried forever. No transaction wraps the batch: a send cannot
   * be rolled back, so holding one open across an HTTP call to Resend would
   * pin a pooled connection for the length of the whole batch and buy
   * nothing.
   */
  async deliverPending(limit = DELIVERY_SWEEP_LIMIT): Promise<NotificationSweepResult> {
    const rows = await this.host.tx.notification.findMany({
      where: { emailStatus: 'PENDING' },
      orderBy: { id: 'asc' },
      take: limit,
      include: { user: { select: { email: true, fullName: true } } },
    });

    const result: NotificationSweepResult = { sent: 0, failed: 0, skipped: 0 };

    for (const row of rows) {
      const outcome = await this.attempt({
        type: row.type as Notification['type'],
        payload: (row.payload ?? {}) as Record<string, unknown>,
        recipientEmail: row.user.email,
        recipientName: row.user.fullName,
      });
      if (outcome.status === 'SENT') result.sent += 1;
      else if (outcome.status === 'SKIPPED') result.skipped += 1;
      else result.failed += 1;

      await this.host.tx.notification.update({
        where: { id: row.id },
        data: {
          emailStatus: outcome.status,
          emailError: outcome.status === 'FAILED' ? outcome.error : null,
        },
      });
    }

    return result;
  }

  /**
   * Delivers one notification immediately, from a payload the caller holds
   * rather than one any row holds, and persists nothing.
   *
   * The only caller is the password reset. Its link is a live credential, so
   * it cannot sit in a JSONB column waiting for the next sweep: the whole
   * point of storing only the token's sha256 is that reading the database
   * yields nothing usable, and a URL in `notification.payload` would hand
   * that straight back, for every pending request at once and for longer
   * than the token's own expiry.
   */
  async deliverNow(notification: DeliverableNotification): Promise<DeliveryOutcome> {
    return this.attempt(notification);
  }

  /**
   * One delivery attempt, which never throws. A refused address, a rate
   * limit and an outage are ordinary outcomes of sending mail, and one of
   * them must not stop the rest of the batch.
   */
  private async attempt(notification: DeliverableNotification): Promise<DeliveryOutcome> {
    try {
      return await this.channel.deliver(notification);
    } catch (e) {
      // The message only. An Error's stack can carry a request object, and
      // this string is stored on the row and shown to an Admin.
      return { status: 'FAILED', error: e instanceof Error ? e.message : String(e) };
    }
  }
}
