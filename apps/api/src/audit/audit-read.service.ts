import { Injectable } from '@nestjs/common';
import type { AuditEntry, AuditListQuery, AuditPage } from '@majlis/contracts';
import { cursorArgs, cursorPage } from '../common/cursor-page';
import { NotFoundError } from '../common/problem/domain-error';
import type { Prisma, AuditLog } from '../generated/prisma/client';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- value import: Nest DI resolves this from design:paramtypes.
import { TransactionHost } from '../prisma/transaction.host';

function toEntry(row: AuditLog): AuditEntry {
  return {
    id: row.id,
    actorUserId: row.actorUserId,
    action: row.action,
    entityType: row.entityType,
    entityId: row.entityId,
    outcome: row.outcome,
    reason: row.reason,
    before: row.before ?? null,
    after: row.after ?? null,
    requestId: row.requestId,
    ip: row.ip,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * The read half of the audit log, deliberately separate from AuditService,
 * which only ever writes. There is no update and no delete here or anywhere:
 * the table is append-only by statement-level trigger.
 */
@Injectable()
export class AuditReadService {
  constructor(private readonly host: TransactionHost) {}

  /** GET /audit. Admin only, whole platform. */
  async list(query: AuditListQuery): Promise<AuditPage> {
    return this.page({
      ...(query.entityType ? { entityType: query.entityType } : {}),
      ...(query.actorUserId ? { actorUserId: query.actorUserId } : {}),
    }, query);
  }

  /**
   * GET /clubs/:clubId/audit. The club row and its own events, and no
   * further: AuditLog has no foreign keys by design (spec 3), so there is no
   * join to walk, and resolving registrations or attendance rows would mean
   * a second unbounded id list. Recorded as a limit and shown in the screen.
   */
  async forClub(clubId: string, query: AuditListQuery): Promise<AuditPage> {
    const club = await this.host.tx.club.findUnique({ where: { id: clubId }, select: { id: true } });
    if (!club) throw new NotFoundError('No such club.');

    const events = await this.host.tx.event.findMany({ where: { clubId }, select: { id: true } });

    return this.page({
      entityId: { in: [clubId, ...events.map((e) => e.id)] },
      ...(query.entityType ? { entityType: query.entityType } : {}),
      ...(query.actorUserId ? { actorUserId: query.actorUserId } : {}),
    }, query);
  }

  private async page(where: Prisma.AuditLogWhereInput, query: AuditListQuery): Promise<AuditPage> {
    const rows = await this.host.tx.auditLog.findMany({ where, ...cursorArgs(query) });
    const { items, nextCursor } = cursorPage(rows, query.limit);
    return { items: items.map(toEntry), nextCursor };
  }
}
