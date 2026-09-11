import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestPrisma, disconnectTestPrisma, truncateAll } from '../db';

const prisma = createTestPrisma();

afterAll(async () => { await disconnectTestPrisma(prisma); });
beforeEach(async () => { await truncateAll(prisma); });

let seq = 0;
const uniq = () => `${Date.now()}-${seq++}-${Math.random().toString(36).slice(2)}`;

async function aUser() {
  return prisma.user.create({
    data: { email: `u.${uniq()}@uni.ac.ae`, passwordHash: 'x', fullName: 'User' },
  });
}

async function anAuditRow() {
  const actor = await aUser();
  return prisma.auditLog.create({
    data: {
      actorUserId: actor.id,
      action: 'club.suspend',
      entityType: 'Club',
      entityId: '00000000-0000-7000-8000-000000000001',
      outcome: 'SUCCESS',
      reason: 'Repeated policy breach',
      before: { status: 'ACTIVE' },
      after: { status: 'SUSPENDED' },
      requestId: 'req-1',
    },
  });
}

describe('AuditLog', () => {
  it('stores before and after snapshots as JSON', async () => {
    const row = await anAuditRow();
    // Re-read rather than trusting the object create() echoes back, so this
    // proves the JSON was actually persisted.
    const persisted = await prisma.auditLog.findUniqueOrThrow({ where: { id: row.id } });
    expect(persisted.before).toEqual({ status: 'ACTIVE' });
    expect(persisted.after).toEqual({ status: 'SUSPENDED' });
  });

  it('records a denial as well as a success', async () => {
    const actor = await aUser();
    const row = await prisma.auditLog.create({
      data: {
        actorUserId: actor.id,
        action: 'event.publish',
        entityType: 'Event',
        entityId: '00000000-0000-7000-8000-000000000002',
        outcome: 'DENIED',
        requestId: 'req-2',
      },
    });
    expect(row.outcome).toBe('DENIED');
  });

  it('is append-only: UPDATE is rejected by the database', async () => {
    const row = await anAuditRow();
    await expect(
      prisma.auditLog.update({ where: { id: row.id }, data: { reason: 'rewritten' } }),
    ).rejects.toThrow(/append-only/i);
  });

  it('is append-only: DELETE is rejected by the database', async () => {
    const row = await anAuditRow();
    await expect(prisma.auditLog.delete({ where: { id: row.id } })).rejects.toThrow(/append-only/i);
  });

  it('is append-only even for a raw bulk UPDATE that bypasses Prisma', async () => {
    await anAuditRow();
    await expect(prisma.$executeRawUnsafe(`UPDATE "audit_log" SET "reason" = 'x'`))
      .rejects.toThrow(/append-only/i);
  });

  it('rejects an UPDATE matching no rows — proving the trigger is statement-level', async () => {
    // The existing bulk-UPDATE test would also pass against a FOR EACH ROW
    // trigger, since it touches a real row. Only a zero-row statement
    // distinguishes the two, and that is the form a careless bulk migration
    // takes.
    await anAuditRow();
    await expect(
      prisma.$executeRawUnsafe(`UPDATE "audit_log" SET "reason" = 'x' WHERE 1 = 0`),
    ).rejects.toThrow(/append-only/i);
  });

  it('rejects a DELETE matching no rows, for the same reason', async () => {
    await anAuditRow();
    await expect(
      prisma.$executeRawUnsafe(`DELETE FROM "audit_log" WHERE 1 = 0`),
    ).rejects.toThrow(/append-only/i);
  });

  it('survives its actor being deleted, because the trail outlives the account', async () => {
    const row = await anAuditRow();
    await prisma.user.delete({ where: { id: row.actorUserId! } });
    const still = await prisma.auditLog.findUnique({ where: { id: row.id } });
    expect(still).not.toBeNull();
    // The actor id is retained verbatim. There is deliberately no foreign key.
    expect(still!.actorUserId).toBe(row.actorUserId);
  });

  it('has no foreign key on actor_user_id, so nothing can cascade into it', async () => {
    const fks = await prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n
      FROM information_schema.table_constraints
      WHERE table_name = 'audit_log' AND constraint_type = 'FOREIGN KEY'`;
    expect(Number(fks[0]!.n)).toBe(0);
  });
});

describe('Notification', () => {
  it('rejects a duplicate dedupe key for the same user, so a retry cannot double-notify', async () => {
    const user = await aUser();
    const data = {
      userId: user.id,
      type: 'registration.confirmed',
      payload: { eventId: 'e1' },
      dedupeKey: 'registration.confirmed:e1',
    };
    await prisma.notification.create({ data });
    await expect(prisma.notification.create({ data })).rejects.toMatchObject({ code: 'P2002' });
  });

  it('allows two different dedupe keys for the same user', async () => {
    // A (user_id)-only unique constraint would allow exactly one
    // notification per user, ever, and would pass every other test in this
    // block — both existing tests only vary the user, never the key.
    const user = await aUser();
    await prisma.notification.create({
      data: {
        userId: user.id,
        type: 'registration.confirmed',
        payload: { eventId: 'e1' },
        dedupeKey: 'registration.confirmed:e1',
      },
    });
    await expect(
      prisma.notification.create({
        data: {
          userId: user.id,
          type: 'registration.confirmed',
          payload: { eventId: 'e2' },
          dedupeKey: 'registration.confirmed:e2',
        },
      }),
    ).resolves.toBeDefined();
  });

  it('allows the same dedupe key for a different user', async () => {
    const [a, b] = [await aUser(), await aUser()];
    const base = { type: 'event.cancelled', payload: {}, dedupeKey: 'event.cancelled:e1' };
    await prisma.notification.create({ data: { ...base, userId: a.id } });
    await expect(prisma.notification.create({ data: { ...base, userId: b.id } })).resolves.toBeDefined();
  });

  it('cascades away when its user is deleted', async () => {
    // The AuditLog half of this contrast is exercised above; without this the
    // cascade is only ever verified by reading the migration SQL.
    const user = await aUser();
    await prisma.notification.create({
      data: { userId: user.id, type: 'certificate.issued', payload: {}, dedupeKey: `k-${uniq()}` },
    });

    await prisma.user.delete({ where: { id: user.id } });
    expect(await prisma.notification.count()).toBe(0);
  });

  it('starts unread with a PENDING email status', async () => {
    const user = await aUser();
    const n = await prisma.notification.create({
      data: { userId: user.id, type: 'certificate.issued', payload: {}, dedupeKey: `k-${uniq()}` },
    });
    expect(n.readAt).toBeNull();
    expect(n.emailStatus).toBe('PENDING');
  });
});
