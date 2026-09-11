# Majlis

University club and event management. One verified student identity, one club
structure, one registration record, one attendance truth, one certificate history.

## Stack

NestJS 12 · Prisma 7 · PostgreSQL 18 (Supabase in production) · Next.js
(App Router) · Tailwind v4 + shadcn/ui · Zod 4 shared contracts · pnpm +
Turborepo

Stage 1 (this repo, currently) builds the API only — `apps/web` lands in a
later stage.

## Getting started

Prerequisites: Node 22.14, pnpm 11.15, PostgreSQL 18 on `localhost:5432`.

```bash
# .env first: postinstall runs `prisma generate`, which loads
# prisma.config.ts and needs DIRECT_URL.
cp .env.example .env
pnpm install

# One-time database bootstrap
psql -U postgres -h localhost -f scripts/bootstrap-db.sql
psql -U postgres -h localhost -c "CREATE DATABASE majlis_dev OWNER majlis;"
psql -U postgres -h localhost -c "CREATE DATABASE majlis_test OWNER majlis;"

pnpm --filter @majlis/api prisma:generate
pnpm --filter @majlis/api prisma:deploy
pnpm --filter @majlis/api db:seed
pnpm --filter @majlis/api start:dev
```

The API is then on <http://localhost:3001/api/v1>, with generated OpenAPI docs
at <http://localhost:3001/api/v1/docs>.

## Commands

| Command | What it does |
| --- | --- |
| `pnpm typecheck` | Typecheck every package |
| `pnpm lint` | Lint every package |
| `pnpm test` | Unit tests |
| `pnpm --filter @majlis/api test:integration` | Integration tests against `majlis_test` |
| `pnpm build` | Build every package |
| `pnpm --filter @majlis/api start:dev` | Run the API in watch mode |
| `pnpm --filter @majlis/api db:seed` | Seed development data (idempotent; refuses when `NODE_ENV=production`, and refuses any non-local database unless `ALLOW_REMOTE_SEED=yes`) |

## Seeded accounts

Development only. Password `Passw0rd!`.

| Email | Role |
| --- | --- |
| `admin@uni.ac.ae` | Platform Admin |
| `lead@uni.ac.ae` | Club Lead of Robotics Club |
| `ops@uni.ac.ae` | Operations Officer of Robotics Club |
| `student@uni.ac.ae` | Student |

## Documentation

- Design spec: [`docs/specs/2026-09-10-majlis-design.md`](docs/specs/2026-09-10-majlis-design.md)
- Plans: [`docs/superpowers/plans/`](docs/superpowers/plans/)
