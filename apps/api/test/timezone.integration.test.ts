import { Client } from 'pg';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestPrisma, disconnectTestPrisma, testDatabaseUrl, truncateAll } from './db';
import { aUser } from './factories';

const prisma = createTestPrisma();

afterAll(async () => {
  await disconnectTestPrisma(prisma);
});
beforeEach(async () => {
  await truncateAll(prisma);
});

/** Midsummer noon UTC, so no DST rule anywhere can account for a shift. */
const INSTANT = new Date('2026-06-15T12:00:00.000Z');

describe('timestamp storage', () => {
  // Reading back through Prisma proves nothing: without the UTC pin it writes
  // and reads through the same offset and returns what it was given while the
  // row holds a different instant. `extract(epoch from ...)` on a fresh pg
  // connection is offset-independent, so it sees the instant actually stored.
  it('stores the instant Prisma was given, not its wall clock', async () => {
    const user = await prisma.user.create({ data: { ...aUser(), createdAt: INSTANT } });

    const client = new Client({ connectionString: testDatabaseUrl() });
    await client.connect();
    try {
      const { rows } = await client.query<{ epoch: string }>(
        'SELECT extract(epoch from "created_at") AS epoch FROM "user" WHERE "id" = $1',
        [user.id],
      );
      expect(Number(rows[0]?.epoch)).toBe(INSTANT.getTime() / 1000);
    } finally {
      await client.end();
    }
  });
});
