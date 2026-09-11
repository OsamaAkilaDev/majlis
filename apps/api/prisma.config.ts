import { config } from 'dotenv';
import { defineConfig, env } from 'prisma/config';

// The workspace keeps one .env at the repo root, two levels up from here.
config({ path: '../../.env' });

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  // Migrations use the DIRECT connection. The application uses the pooled
  // one via the driver adapter in PrismaService — on Supabase those differ
  // (:5432 direct, :6543 transaction pooler), and migrations cannot run
  // through pgBouncer.
  //
  // shadowDatabaseUrl is required for `prisma migrate diff` to compare
  // `--from-migrations` against `--to-schema` — Prisma 7's CLI dropped the
  // `--shadow-database-url` flag that command used to take, so it has to be
  // set here instead. Prisma creates and drops this database around each
  // diff/dev run; the connecting role needs CREATEDB.
  datasource: { url: env('DIRECT_URL'), shadowDatabaseUrl: env('SHADOW_DATABASE_URL') },
});
