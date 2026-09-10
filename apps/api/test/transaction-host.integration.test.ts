import type { ConfigService } from '@nestjs/config';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { Env } from '../src/config/env.schema';
import { PrismaService } from '../src/prisma/prisma.service';
import { TransactionHost } from '../src/prisma/transaction.host';
import { testDatabaseUrl, truncateAll } from './db';

const config = { get: () => testDatabaseUrl() } as unknown as ConfigService<Env, true>;
const prisma = new PrismaService(config);
const host = new TransactionHost(prisma);

let seq = 0;
const email = () => `tx.${Date.now()}.${seq++}@uni.ac.ae`;

afterAll(async () => { await prisma.$disconnect(); });
// PrismaService extends PrismaClient, so it satisfies truncateAll directly.
beforeEach(async () => { await truncateAll(prisma); });

describe('TransactionHost', () => {
  it('returns the base client when no transaction is running', async () => {
    await host.tx.user.create({ data: { email: email(), passwordHash: 'x', fullName: 'A' } });
    expect(await prisma.user.count()).toBe(1);
  });

  it('commits every write made inside run()', async () => {
    await host.run(async () => {
      await host.tx.user.create({ data: { email: email(), passwordHash: 'x', fullName: 'A' } });
      await host.tx.user.create({ data: { email: email(), passwordHash: 'x', fullName: 'B' } });
    });
    expect(await prisma.user.count()).toBe(2);
  });

  it('rolls back every write when the callback throws', async () => {
    await expect(
      host.run(async () => {
        await host.tx.user.create({ data: { email: email(), passwordHash: 'x', fullName: 'A' } });
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await prisma.user.count()).toBe(0);
  });

  it('joins the ambient transaction rather than opening a nested one', async () => {
    // Simulates an audit writer called deep inside a service: it never
    // receives a tx handle, yet its write must share the outer transaction.
    async function auditWriterDeepInTheStack() {
      await host.tx.auditLog.create({
        data: {
          action: 'user.create',
          entityType: 'User',
          entityId: '00000000-0000-7000-8000-000000000001',
          outcome: 'SUCCESS',
          requestId: 'req-1',
        },
      });
    }

    await expect(
      host.run(async () => {
        await host.tx.user.create({ data: { email: email(), passwordHash: 'x', fullName: 'A' } });
        await host.run(auditWriterDeepInTheStack);
        throw new Error('action failed after auditing');
      }),
    ).rejects.toThrow('action failed after auditing');

    // Both the action and its audit row rolled back together.
    expect(await prisma.user.count()).toBe(0);
    expect(await prisma.auditLog.count()).toBe(0);
  });

  it('returns the callback result, from both the opening and the joining path', async () => {
    // run() has two distinct return paths — one that opens a transaction and
    // one that joins an ambient one. Every other test here asserts only on
    // database side effects, so a regression that awaited the callback but
    // discarded its value would pass all of them.
    expect(await host.run(async () => 'outer')).toBe('outer');

    const joined = await host.run(async () => host.run(async () => 'inner'));
    expect(joined).toBe('inner');
  });

  it('restores the base client once run() resolves', async () => {
    // Proves the AsyncLocalStorage scope does not leak past the callback.
    expect(host.tx).toBe(prisma);

    await host.run(async () => {
      expect(host.tx).not.toBe(prisma);
    });

    expect(host.tx).toBe(prisma);
  });

  it('isolates concurrent transactions from each other', async () => {
    const results = await Promise.allSettled([
      host.run(async () => {
        await host.tx.user.create({ data: { email: email(), passwordHash: 'x', fullName: 'A' } });
      }),
      host.run(async () => {
        await host.tx.user.create({ data: { email: email(), passwordHash: 'x', fullName: 'B' } });
        throw new Error('second fails');
      }),
    ]);

    expect(results[0]!.status).toBe('fulfilled');
    expect(results[1]!.status).toBe('rejected');
    expect(await prisma.user.count()).toBe(1);
  });
});
