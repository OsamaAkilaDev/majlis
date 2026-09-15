import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AuditService } from '../src/audit/audit.service';
import { RequestContext } from '../src/common/request-context';
import { TransactionHost } from '../src/prisma/transaction.host';
import { createTestApp } from './app';
import { createTestPrisma, disconnectTestPrisma, truncateAll } from './db';
import { aUser } from './factories';

const prisma = createTestPrisma();
let app: INestApplication;

beforeAll(async () => {
  app = await createTestApp();
});

afterAll(async () => {
  await app.close();
  await disconnectTestPrisma(prisma);
});

beforeEach(async () => {
  await truncateAll(prisma);
});

describe('AuditService', () => {
  it('rolls the audit row back with the action that failed', async () => {
    // Catches an audit writer that injects PrismaService (or otherwise
    // escapes the ambient transaction): such a writer would commit the
    // audit row immediately, independent of host.run()'s rollback, leaving
    // a row that claims an action which never actually happened.
    const host = app.get(TransactionHost);
    const audit = app.get(AuditService);
    const user = await prisma.user.create({ data: aUser() });

    await expect(
      host.run(async () => {
        await host.tx.user.update({ where: { id: user.id }, data: { fullName: 'Changed' } });
        await audit.record({
          action: 'user.updated',
          entityType: 'User',
          entityId: user.id,
          outcome: 'SUCCESS',
        });
        throw new Error('the action failed after the audit row was written');
      }),
    ).rejects.toThrow('the action failed');

    expect(await prisma.auditLog.count({ where: { entityId: user.id } })).toBe(0);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).fullName).toBe(
      'Test Person',
    );
  });

  it('writes the row when the action commits', async () => {
    const host = app.get(TransactionHost);
    const audit = app.get(AuditService);
    const user = await prisma.user.create({ data: aUser() });

    await host.run(() =>
      audit.record({
        action: 'user.suspended',
        entityType: 'User',
        entityId: user.id,
        outcome: 'SUCCESS',
        reason: 'testing',
      }),
    );

    const rows = await prisma.auditLog.findMany({ where: { entityId: user.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.action).toBe('user.suspended');
  });

  it('falls back to the literal "unknown" requestId when no RequestContext is running', async () => {
    // Pins the fallback branch exactly, rather than `toBeTruthy()`, which
    // 'unknown' itself satisfies and so cannot tell "correctly fell back"
    // from "ignored RequestContext entirely and hardcoded something else
    // truthy".
    const audit = app.get(AuditService);
    const user = await prisma.user.create({ data: aUser() });

    await audit.record({
      action: 'user.suspended',
      entityType: 'User',
      entityId: user.id,
      outcome: 'SUCCESS',
    });

    const row = await prisma.auditLog.findFirstOrThrow({ where: { entityId: user.id } });
    expect(row.requestId).toBe('unknown');
    expect(row.ip).toBeNull();
  });

  it('threads requestId and ip from the ambient RequestContext', async () => {
    // Catches a service that ignores RequestContext and always hardcodes
    // the 'unknown' fallback: the previous test alone can't distinguish
    // "correctly read the ambient facts" from "always writes 'unknown'",
    // since neither wrapped the call in RequestContext.run.
    const context = app.get(RequestContext);
    const audit = app.get(AuditService);
    const user = await prisma.user.create({ data: aUser() });

    await context.run({ requestId: 'req-123', ip: '1.2.3.4' }, () =>
      audit.record({
        action: 'user.suspended',
        entityType: 'User',
        entityId: user.id,
        outcome: 'SUCCESS',
      }),
    );

    const row = await prisma.auditLog.findFirstOrThrow({ where: { entityId: user.id } });
    expect(row.requestId).toBe('req-123');
    expect(row.ip).toBe('1.2.3.4');
  });

  it('omits actorUserId for an unauthenticated denial rather than writing a fabricated one', async () => {
    // Catches an implementation that defaults a missing actorUserId to some
    // placeholder (e.g. '' or a system user id) instead of leaving it null:
    // that would misattribute an anonymous denial to a real account.
    const audit = app.get(AuditService);
    await audit.record({
      action: 'auth.login.denied',
      entityType: 'User',
      entityId: '00000000-0000-7000-8000-000000000099',
      outcome: 'DENIED',
      reason: 'bad credentials',
    });

    const row = await prisma.auditLog.findFirstOrThrow({
      where: { entityId: '00000000-0000-7000-8000-000000000099' },
    });
    expect(row.actorUserId).toBeNull();
    expect(row.outcome).toBe('DENIED');
  });

  it('persists before/after snapshots, and writes real SQL NULL when they are omitted', async () => {
    // Catches passing a JSON literal `null` (Prisma.JsonNull) or a bare `null`
    // cast into the input type when the caller never supplied before/after:
    // both would put a `"null"` JSON value in the column, not the SQL NULL a
    // reader of a snapshot-less row (a DENIED entry, most of them) expects.
    const audit = app.get(AuditService);
    const user = await prisma.user.create({ data: aUser() });

    await audit.record({
      action: 'club.suspend',
      entityType: 'Club',
      entityId: user.id,
      outcome: 'SUCCESS',
      before: { status: 'ACTIVE' },
      after: { status: 'SUSPENDED' },
    });

    const withSnapshots = await prisma.auditLog.findFirstOrThrow({
      where: { entityId: user.id, action: 'club.suspend' },
    });
    expect(withSnapshots.before).toEqual({ status: 'ACTIVE' });
    expect(withSnapshots.after).toEqual({ status: 'SUSPENDED' });

    await audit.record({
      action: 'club.suspend.no-snapshot',
      entityType: 'Club',
      entityId: user.id,
      outcome: 'SUCCESS',
    });

    // Both a real SQL NULL and a stored JSON `null` scalar come back as JS
    // `null` once node-postgres/pg-types parses the column. That driver
    // parsing (JSON.parse) is exactly why an ordinary Prisma or $queryRaw
    // read of the value can't discriminate Prisma.DbNull from
    // Prisma.JsonNull. jsonb_typeof forces the check to happen in Postgres,
    // before any driver-side parsing: it returns SQL NULL for an actual SQL
    // NULL, and the string 'null' for a stored JSON null scalar.
    const typeofResult = await prisma.$queryRaw<{ before_type: string | null; after_type: string | null }[]>`
      SELECT jsonb_typeof("before") AS before_type, jsonb_typeof("after") AS after_type
      FROM "audit_log"
      WHERE entity_id = ${user.id} AND action = 'club.suspend.no-snapshot'`;
    expect(typeofResult[0]?.before_type).toBeNull();
    expect(typeofResult[0]?.after_type).toBeNull();
  });
});
