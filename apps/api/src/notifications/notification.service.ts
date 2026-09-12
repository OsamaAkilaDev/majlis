import { Injectable } from '@nestjs/common';
import type { Notification, NotificationListQuery, NotificationPage } from '@majlis/contracts';
import { cursorArgs, cursorPage } from '../common/cursor-page';
import { NotFoundError } from '../common/problem/domain-error';
import type { Prisma, Notification as NotificationRow } from '../generated/prisma/client';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- value import: Nest DI resolves this from design:paramtypes.
import { TransactionHost } from '../prisma/transaction.host';
import { PASSWORD_RESET_TYPE, dedupeKeyFor, type NotificationEntry } from './notification-types';

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
  constructor(private readonly host: TransactionHost) {}

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
}
