import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { testDatabaseUrl } from './db';

/**
 * Applies all migrations to the test database once, before any test file runs.
 *
 * `prisma migrate deploy` errors on an empty migrations directory, which is
 * the state until the first schema task lands, so this is a no-op until
 * there is something to apply.
 */
export default function setup(): void {
  const url = testDatabaseUrl();
  const dir = join(__dirname, '..', 'prisma', 'migrations');

  const hasMigrations =
    existsSync(dir) && readdirSync(dir, { withFileTypes: true }).some((e) => e.isDirectory());

  if (!hasMigrations) return;

  execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, DATABASE_URL: url, DIRECT_URL: url },
  });
}
