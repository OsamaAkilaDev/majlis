import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestPrisma, disconnectTestPrisma, truncateAll } from './db';

// TEST_DATABASE_URL is normally unset (db.ts derives it). Assigning undefined
// to process.env would store the string 'undefined'.
function restore(saved: string | undefined): void {
  if (saved === undefined) delete process.env.TEST_DATABASE_URL;
  else process.env.TEST_DATABASE_URL = saved;
}

const prisma = createTestPrisma();

afterAll(async () => {
  await disconnectTestPrisma(prisma);
});

beforeEach(async () => {
  await truncateAll(prisma);
});

describe('integration test harness', () => {
  it('connects to the test database and it is Postgres 18 or newer', async () => {
    const rows = await prisma.$queryRaw<{ v: number }[]>`SELECT current_setting('server_version_num')::int AS v`;
    expect(rows[0]!.v).toBeGreaterThanOrEqual(180000);
  });

  it('is pointed at majlis_test, never at the development database', async () => {
    const rows = await prisma.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`;
    expect(rows[0]!.db).toBe('majlis_test');
  });

  it('refuses a connection string that does not name the test database', async () => {
    const saved = process.env.TEST_DATABASE_URL;
    try {
      process.env.TEST_DATABASE_URL = 'postgresql://majlis:majlis@localhost:5432/majlis_dev';
      expect(() => createTestPrisma()).toThrow(/non-test database/);
    } finally {
      restore(saved);
    }
  });

  it('refuses a connection string where "majlis_test" appears only in the username, not the database name', async () => {
    // A substring check on the whole URL would pass this: "majlis_test"
    // matches the username, but the actual database is majlis_prod. Only a
    // parsed-pathname comparison catches it.
    const saved = process.env.TEST_DATABASE_URL;
    try {
      process.env.TEST_DATABASE_URL = 'postgresql://majlis_test_ro:pw@prod-host:5432/majlis_prod';
      expect(() => createTestPrisma()).toThrow(/non-test database/);
    } finally {
      restore(saved);
    }
  });

  it('truncateAll is idempotent', async () => {
    // There have been application tables since Task 5; this no longer tests
    // running against an empty schema. It asserts that truncating twice in a
    // row (beforeEach already truncated once) does not error.
    await expect(truncateAll(prisma)).resolves.toBeUndefined();
    await expect(truncateAll(prisma)).resolves.toBeUndefined();
  });
});
