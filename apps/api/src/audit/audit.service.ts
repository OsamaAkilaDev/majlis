import { Injectable } from '@nestjs/common';
import { TransactionHost } from '../prisma/transaction.host';
import { RequestContext } from '../common/request-context';
import { Prisma } from '../generated/prisma/client';

export interface AuditEntry {
  action: string;
  entityType: string;
  entityId: string;
  outcome: 'SUCCESS' | 'DENIED';
  reason?: string;
  before?: unknown;
  after?: unknown;
  actorUserId?: string;
}

/**
 * Writes through host.tx, so the row enlists in whatever transaction the caller
 * opened: that is what makes "the audit row is written in the same transaction
 * as the action" structural rather than a rule someone has to remember.
 * The table is append-only by statement-level trigger: no update, no delete.
 */
@Injectable()
export class AuditService {
  constructor(
    private readonly host: TransactionHost,
    private readonly context: RequestContext,
  ) {}

  async record(entry: AuditEntry): Promise<void> {
    const facts = this.context.current;

    // before/after are an optional Json column: `Prisma.JsonNull` writes the
    // JSON value `null`, `Prisma.DbNull` leaves the column SQL NULL, and a bare
    // JS `null` is not a valid create input at all. `== null` (not
    // `=== undefined`) so a caller passing an explicit null to mean "no
    // snapshot" takes the DbNull branch too.
    await this.host.tx.auditLog.create({
      data: {
        actorUserId: entry.actorUserId ?? null,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId,
        outcome: entry.outcome,
        reason: entry.reason ?? null,
        before: entry.before == null ? Prisma.DbNull : (entry.before as Prisma.InputJsonValue),
        after: entry.after == null ? Prisma.DbNull : (entry.after as Prisma.InputJsonValue),
        requestId: facts?.requestId ?? 'unknown',
        ip: facts?.ip ?? null,
      },
    });
  }
}
