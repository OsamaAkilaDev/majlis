import { config } from 'dotenv';
import { defineConfig } from 'prisma/config';

// The workspace keeps one .env at the repo root, two levels up from here.
config({ path: '../../.env' });

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  // Migrations cannot run through pgBouncer, so on Supabase set DIRECT_URL to
  // the :5432 connection. Locally DATABASE_URL is already direct.
  // SHADOW_DATABASE_URL is only read by `prisma migrate diff`, which CI sets
  // it for; `migrate dev` creates and drops its own when it is unset.
  datasource: {
    url: process.env.DIRECT_URL ?? process.env.DATABASE_URL!,
    shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL,
  },
});
