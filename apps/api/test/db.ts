import { PrismaClient } from '../src/generated/prisma/client';
import { pgAdapter } from '../src/prisma/pg-adapter';

/** Resolves the test connection string, refusing anything else. */
export function testDatabaseUrl(): string {
  return assertTestDb(process.env.TEST_DATABASE_URL ?? derive(process.env.DATABASE_URL, 'DATABASE_URL'));
}

/** The same test database without the connection pooler. `prisma migrate` takes
 * an advisory lock and issues DDL, which hangs forever through pgBouncer in
 * transaction pooling mode, with no error and no timeout. Only the migration
 * step needs this; the tests themselves stay on the pooled URL, like production. */
export function testDirectDatabaseUrl(): string {
  return assertTestDb(
    process.env.TEST_DIRECT_URL ??
      process.env.TEST_DATABASE_URL ??
      derive(process.env.DIRECT_URL ?? process.env.DATABASE_URL, 'DIRECT_URL or DATABASE_URL'),
  );
}

/** The name is parsed out of the URL, not matched as a substring: a substring
 * check passes on `postgresql://majlis_test_ro:pw@prod-host/majlis_prod`, and
 * truncateAll would then TRUNCATE a production schema. */
function assertTestDb(url: string): string {
  const { pathname } = new URL(url);
  if (pathname !== '/majlis_test') {
    throw new Error(`Refusing to run integration tests against a non-test database: ${url}`);
  }
  return url;
}

// Same server and credentials as development, different name. CI overrides with
// TEST_DATABASE_URL.
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

/** Empties every application table between tests. `_prisma_migrations` is kept
 * so migrations run once per suite rather than once per test. */
export async function truncateAll(prisma: PrismaClient): Promise<void> {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;

  if (tables.length === 0) return;

  const list = tables.map((t) => `"public"."${t.tablename}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}
