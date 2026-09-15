# Majlis

University club and event management. One student identity, one club structure,
one registration record, one attendance truth, one certificate history.

Clubs, membership, events, registration with capacity and waitlist, QR check-in,
certificate issuance and public certificate verification, notifications and
reporting. Three app shells: student (mobile-first), club officer, and admin.

Running it in production needs more than this file covers. See
[`docs/handbook.md`](docs/handbook.md).

## Stack

| | |
| --- | --- |
| API | NestJS 12, Prisma 7, PostgreSQL 18, Zod 4 |
| Web | Next.js 16 (App Router), Tailwind v4, shadcn/ui component layer |
| Shared | `@majlis/contracts`, Zod schemas that generate the OpenAPI document |
| Tooling | pnpm 11, Turborepo, Vitest, Playwright |
| Hosting | Web on Vercel, API on Render, with Supabase for Postgres and object storage |

## Prerequisites

- Node 22.14 or later
- pnpm 11.15 or later
- PostgreSQL 18 on `localhost:5432`, with the `pg_trgm` extension available
  (the migrations create it; the database role needs to be allowed to)

## Getting it running

```bash
# .env first: install runs `prisma generate`, which loads prisma.config.ts
# and reads the connection string from there.
cp .env.example .env
pnpm install

# One-time database bootstrap
psql -U postgres -h localhost -f scripts/bootstrap-db.sql
psql -U postgres -h localhost -c "CREATE DATABASE majlis_dev OWNER majlis;"
psql -U postgres -h localhost -c "CREATE DATABASE majlis_test OWNER majlis;"

pnpm --filter @majlis/api prisma:deploy
pnpm --filter @majlis/api db:seed

pnpm --filter @majlis/api start:dev    # http://localhost:3001
pnpm --filter @majlis/web dev          # http://localhost:3000
```

`pnpm db:check` prints the server version if `DATABASE_URL` connects.

Image upload and certificate PDFs need `SUPABASE_STORAGE_URL` and
`SUPABASE_SERVICE_ROLE_KEY`, and two buckets that nothing in this repository
creates. The handbook has the details; everything else works without them.

The web app proxies `/api/v1/*` to the API, so browse the product at
<http://localhost:3000>. Generated OpenAPI docs are at
<http://localhost:3001/api/v1/docs> outside production.

### First admin on a fresh deployment

A database with no admin sends `/login` to `/setup`, which creates one and signs you in.
Nothing else in the product can: no route writes `platformRole`, and the seed below is
development-only. The screen closes for good once an admin exists.

It is unauthenticated, so on a public deployment claim the account immediately after the
first deploy. Until you do, whoever reaches the URL can.

### Seeded accounts

Development only. Password `Passw0rd!`.

| Email | Role |
| --- | --- |
| `admin@uni.ac.ae` | Platform Admin |
| `lead@uni.ac.ae` | Club Lead of Robotics Club |
| `ops@uni.ac.ae` | Operations Officer of Robotics Club |
| `student@uni.ac.ae` | Student |

## Tests

```bash
pnpm typecheck && pnpm lint && pnpm test      # unit tests, every package
pnpm --filter @majlis/api test:integration    # against majlis_test
pnpm --filter @majlis/web test:e2e            # Playwright + axe, needs both servers up
API_ORIGIN=http://localhost:3001 pnpm build
```

Integration tests run against a real PostgreSQL. They derive `majlis_test` from
`DATABASE_URL` and refuse any connection string that does not name it;
`TEST_DATABASE_URL` overrides.

Restart `next dev` before an e2e run. A long-lived one grows past Node's heap
limit and fails to compile routes, which surfaces in Playwright as
`element(s) not found`.

## Commands

| Command | What it does |
| --- | --- |
| `pnpm build` | Build every package. Needs `API_ORIGIN`: a production web build refuses the localhost default |
| `pnpm lint` | ESLint over every package. TypeScript only, no markdown |
| `pnpm --filter @majlis/api start:dev` | API in watch mode, SWC register |
| `pnpm --filter @majlis/api prisma:deploy` | Apply migrations |
| `pnpm --filter @majlis/api prisma:migrate` | Create and apply a migration in development |
| `pnpm --filter @majlis/api db:seed` | Seed development data. Idempotent. Refuses `NODE_ENV=production`, and any non-local database unless `ALLOW_REMOTE_SEED=yes` |
| `pnpm format` | Prettier |

## Deployment

| | Where | Configured by |
| --- | --- | --- |
| Web | Vercel | Dashboard. Root directory `apps/web`, and `API_ORIGIN` pointing at the API |
| API | Render | [`render.yaml`](render.yaml), committed |
| Postgres, object storage | Supabase | Two buckets, created by hand. See the handbook |

**Node 22.12 or newer is required.** NestJS 12 is ESM-only and this app compiles
to CommonJS, so it depends on `require(esm)`. On anything older the process dies
on its first import. It is also why the API is not deployed serverless: Vercel's
function loader rejects `require(esm)` at any Node version.

Migrations run in the Render build, so a schema change ships with the commit that
makes it and a failed migration fails the deploy. On Supabase, use the **session
pooler** hostname for both `DATABASE_URL` and `DIRECT_URL`; the direct
`db.<ref>.supabase.co` host is IPv6-only and unreachable from most build machines.

## Layout

```
apps/api           NestJS API. Modules by domain, Prisma schema and migrations in prisma/
apps/web           Next.js app. Route groups: (student) (club) (admin) (auth) (public)
packages/contracts Zod schemas shared by both, and the source of the OpenAPI document
docs/specs         Design spec and per-stage design notes
docs/superpowers   One implementation plan per stage
scripts            Database bootstrap SQL
```

## Documentation

- Operator handbook: [`docs/handbook.md`](docs/handbook.md)
- Design spec, binding: [`docs/specs/2026-09-10-majlis-design.md`](docs/specs/2026-09-10-majlis-design.md).
  Section 3 is the decisions ledger, section 13 the build stages and their
  completion notes.
- Agent rules: [`CLAUDE.md`](CLAUDE.md)
