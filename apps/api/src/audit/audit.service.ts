import { Injectable } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- value import: Nest DI resolves this from design:paramtypes.
import { TransactionHost } from '../prisma/transaction.host';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- value import: see above.
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
 * Writes through host.tx, so a row enlists in whatever transaction the caller
 * opened. That is what makes "the audit row is written in the same
 * transaction as the action" structural rather than a rule someone has to
 * remember — and what makes the rollback test in audit.integration.test.ts
 * the definition of the guarantee rather than a nicety.
 *
 * The table is append-only by statement-level trigger. There is no update
 * and no delete, here or anywhere.
 */
@Injectable()
export class AuditService {
  constructor(
    private readonly host: TransactionHost,
    private readonly context: RequestContext,
  ) {}

  async record(entry: AuditEntry): Promise<void> {
    const facts = this.context.current;

    // before/after are an optional Json column. A bare JS `null` is not a
    // valid value for Prisma's create input here (the generated type is
    // `NullableJsonNullValueInput | InputJsonValue`, which excludes literal
    // `null`) — and `Prisma.JsonNull` would write the JSON value `null`
    // into the column, not leave it SQL NULL. `Prisma.DbNull` is the
    // sentinel that means "no snapshot", i.e. an actual SQL NULL.
    //
    // `== null` (not `=== undefined`) catches both an omitted key and an
    // explicit `before: null` from a caller — AuditEntry['before'] is
    // `unknown`, so nothing stops a future caller (Tasks 8/10/11) from
    // passing null on purpose to mean "no snapshot", and that must take the
    // DbNull branch too rather than falling through to a cast that lies
    // about `null` being a valid InputJsonValue.
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
