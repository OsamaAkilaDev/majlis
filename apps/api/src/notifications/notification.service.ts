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
import { TransactionHost } from '../prisma/transaction.host';
import {
  NOTIFICATION_CHANNEL,
  type DeliverableNotification,
  type DeliveryOutcome,
  type NotificationChannel,
} from './notification-channel';
import { PASSWORD_RESET_TYPE, dedupeKeyFor, type NotificationEntry } from './notification-types';

const DELIVERY_SWEEP_LIMIT = 500;

function toNotification(row: NotificationRow): Notification {
  return {
    id: row.id,
    // The column is a plain string, the enum is the contract's: a row written
    // before a type was renamed fails the response schema rather than being
    // silently reshaped here.
    type: row.type as Notification['type'],
    payload: (row.payload ?? {}) as Record<string, unknown>,
    readAt: row.readAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Writes through `host.tx`, so the row enlists in the caller's transaction,
 * which is what makes spec 7.7's "same transaction as the triggering action"
 * structural. Nothing here sends: `email_status` starts PENDING and delivery
 * is a separate post-commit sweep, so a failed email cannot roll back the
 * action that caused it.
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
   * `skipDuplicates` is `ON CONFLICT DO NOTHING`, which absorbs a repeat inside
   * the transaction. Catching P2002 instead would not work: Postgres aborts the
   * whole transaction on a constraint violation, leaving a connection that
   * refuses every further statement. Returns rows actually inserted.
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
   * Self-scoped by `userId`; no route lists another user's. `auth.password_reset`
   * is excluded as non-inbox material, not as a leak: its payload is only
   * `{ expiresInMinutes }` and the raw token never reaches any row.
   */
  async list(actor: { id: string }, query: NotificationListQuery): Promise<NotificationPage> {
    const rows = await this.host.tx.notification.findMany({
      where: {
        userId: actor.id,
        type: { not: PASSWORD_RESET_TYPE },
        ...(query.unread === undefined ? {} : query.unread ? { readAt: null } : { readAt: { not: null } }),
      },
      ...cursorArgs(query, 'desc'),
    });

    const { items, nextCursor } = cursorPage(rows, query.limit);
    return { items: items.map(toNotification), nextCursor };
  }

  // Scoped to the actor, and somebody else's notification is not found rather
  // than forbidden: a 403 would confirm an id the caller was never shown exists.
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
   * A sweep rather than fire-and-forget after each commit, so a notification
   * whose process died between commit and send is not lost. PENDING only, so a
   * FAILED row is attempted once and not retried forever. No transaction wraps
   * the batch: a send cannot be rolled back, and one held open across the HTTP
   * call to Brevo would pin a pooled connection for the whole batch.
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
   * Delivers from a payload the caller holds and persists nothing. The only
   * caller is the password reset: its link is a live credential, and a URL
   * sitting in `notification.payload` would undo the point of storing only the
   * token's sha256.
   */
  async deliverNow(notification: DeliverableNotification): Promise<DeliveryOutcome> {
    return this.attempt(notification);
  }

  // Never throws: a refused address or an outage is an ordinary outcome of
  // sending mail and must not stop the rest of the batch.
  private async attempt(notification: DeliverableNotification): Promise<DeliveryOutcome> {
    try {
      return await this.channel.deliver(notification);
    } catch (e) {
      // The message only: a stack can carry a request object, and this string
      // is stored on the row and shown to an Admin.
      return { status: 'FAILED', error: e instanceof Error ? e.message : String(e) };
    }
  }
}
