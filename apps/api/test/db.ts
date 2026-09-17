import { PrismaClient } from '../src/generated/prisma/client';
import { pgAdapter } from '../src/prisma/pg-adapter';

/**
 * Resolves the test connection string, refusing to run against anything
 * else.
 *
 * The database name is parsed out of the URL rather than matched as a
 * substring of the whole string. A substring check on
 * `postgresql://majlis_test_ro:pw@prod-host/majlis_prod` would pass (the
 * marker matches the username) and truncateAll would then TRUNCATE every
 * table in a production database's public schema.
 */
export function testDatabaseUrl(): string {
  return assertTestDb(process.env.TEST_DATABASE_URL ?? derive(process.env.DATABASE_URL, 'DATABASE_URL'));
}

/**
 * The same test database, reached without the connection pooler.
 *
 * `prisma migrate` cannot run through pgBouncer: it takes an advisory lock and
 * issues DDL, and in transaction pooling mode it simply hangs, with no error
 * and no timeout. Supabase's `DATABASE_URL` is the pooled `:6543` endpoint, so
 * deriving the migrate URL from it wedged `global-setup.ts` forever and the
 * integration suite could not start at all.
 *
 * Only the migration step needs this. The Prisma client the tests themselves
 * run on stays on the pooled URL, which is what the app uses in production.
 */
export function testDirectDatabaseUrl(): string {
  return assertTestDb(
    process.env.TEST_DIRECT_URL ??
      process.env.TEST_DATABASE_URL ??
      derive(process.env.DIRECT_URL ?? process.env.DATABASE_URL, 'DIRECT_URL or DATABASE_URL'),
  );
}

/**
 * The database name is parsed out of the URL rather than matched as a
 * substring of the whole string. A substring check on
 * `postgresql://majlis_test_ro:pw@prod-host/majlis_prod` would pass (the
 * marker matches the username) and truncateAll would then TRUNCATE every
 * table in a production database's public schema.
 */
function assertTestDb(url: string): string {
  const { pathname } = new URL(url);
  if (pathname !== '/majlis_test') {
    throw new Error(`Refusing to run integration tests against a non-test database: ${url}`);
  }
  return url;
}

// Same server and credentials as the development database, different name.
// CI overrides it with TEST_DATABASE_URL.
function derive(base: string | undefined, name: string): string {
  if (!base) throw new Error(`${name} is not set. Copy .env.example to .env.`);

  const url = new URL(base);
  url.pathname = '/majlis_test';
  return url.toString();
}

export function createTestPrisma(): PrismaClient {
  return new PrismaClient({ adapter: pgAdapter(testDatabaseUrl()) });
}

export async function disconnectTestPrisma(prisma: PrismaClient): Promise<void> {
  await prisma.$disconnect();
}

/**
 * Empties every application table between tests. `_prisma_migrations` is
 * preserved so migrations are applied once per run rather than once per test.
 */
export async function truncateAll(prisma: PrismaClient): Promise<void> {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;

  if (tables.length === 0) return;

  const list = tables.map((t) => `"public"."${t.tablename}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}
