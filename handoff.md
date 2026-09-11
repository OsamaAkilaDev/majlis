# Handoff

**Read this first, then `docs/specs/2026-09-10-majlis-design.md`.** The spec is the
binding authority; this file is only what an agent picking up mid-project needs that
the spec doesn't say.

**Written:** 2026-09-11, after Stage 1 shipped.
**Delete or update this file once you've reconciled it into the permanent docs.**

---

## Where things stand

**Stage 1 (Foundation) is complete and merged to `master`.** 65 commits, clean tree,
nothing pushed anywhere.

| | |
|---|---|
| Tests | 32 unit, 100 integration — all green against real PostgreSQL 18 |
| Migrations | 7 applied |
| HTTP surface | `GET /api/v1/health` and `/api/v1/docs` only. **No auth, no business endpoints yet.** |
| Remote | **None.** Nothing has been published; that's the human's call. |

**Stage 2 is next: auth and users** — signup, login, refresh rotation with reuse
detection, the session guard, the permission guard skeleton, user suspension. See
spec §13 for the full twelve-stage sequence.

---

## Before you touch anything

```bash
pnpm install                       # postinstall runs prisma generate
pnpm --filter @majlis/api prisma:deploy
pnpm --filter @majlis/api db:seed
pnpm --filter @majlis/api start:dev
```

Requires PostgreSQL 18 on `localhost:5432` with role `majlis` and databases
`majlis_dev` / `majlis_test` (`scripts/bootstrap-db.sql` creates the role). Copy
`.env.example` to `.env` first. `pnpm db:check` confirms connectivity.

Full sequence CI runs, and what you should run before claiming anything works:

```bash
pnpm install --frozen-lockfile
pnpm --filter @majlis/api prisma:generate
pnpm typecheck && pnpm lint && pnpm test
pnpm --filter @majlis/api test:integration
pnpm build
```

---

## Things that will waste your time if you don't know them

These were each discovered the hard way during Stage 1. Every one is a real,
verified behaviour — not a precaution.

**`@nestjs/cli` is deliberately absent and must stay absent.** Version 12.0.0 is the
only stable 12.x and it cannot run *at all* — even `nest --version` dies with
`ERR_REQUIRE_CYCLE_MODULE`, because it pins ESM-only `ora@9.4.1` while
`@angular-devkit/schematics` `require()`s it in a cycle. `build` is `tsc`. Don't
reinstall it; don't write `nest build` in docs.

**The dev loop uses SWC, not `tsx`.** `tsx` transforms via esbuild, which does not
implement `emitDecoratorMetadata`, so NestJS constructor injection silently breaks —
`ConfigService` arrives `undefined`. `start:dev` is
`node --watch -r @swc-node/register`. `tsx` remains a devDependency *only* for
`db:seed`, which is a plain script with no DI.

**Prisma 7 is not Prisma 6.** The `datasource` block takes `provider` only — a `url`
there is a hard `P1012` error. Connection strings live in `apps/api/prisma.config.ts`
(migrations use `DIRECT_URL`, the app uses pooled `DATABASE_URL` through the
mandatory driver adapter). `migrate dev` does **not** auto-run `generate`; run it
yourself or your new models won't exist on the client.

**Never add an enum without `@@map`.** Adding one *after* the enum's creating
migration makes Prisma generate a destructive `DROP TYPE` plus column rewrite. All
16 existing enums carry theirs.

**`API_PREFIX`'s leading slash is load-bearing.** `@nestjs/core`'s
`registerNotFoundHandler` and `registerExceptionHandler` skip the normalisation
`registerRouter` applies, so `'api/v1'` routes 404s and unhandled errors *around
every exception filter* — silently, with all tests still passing. Always use the
`API_PREFIX` constant.

**pnpm 11 refuses packages published in the last 24 hours.** Never pin something
newer than ~48 hours, and **never** add a `minimumReleaseAgeExclude` to get around
it — that bypasses a supply-chain protection. Pick an older patch. Also: verify
every version exists on npm before pinning. The Stage 1 plan contained several
that never existed.

**`user` is a reserved word in PostgreSQL.** Quote it in raw SQL: `ALTER TABLE "user"`.

**Hand-written SQL in migrations is safe.** Partial unique indexes and CHECK
constraints appended to a generated migration are *not* treated as drift by a later
`migrate dev`. Verified empirically. Keep using `--create-only` then appending.

---

## How this codebase expects you to work

**Invariants live in the database.** Every guarantee in spec §5.2 is a partial unique
index, CHECK constraint or trigger — not an application check. When you add one, add
the SQL by hand and write a test that fails without it.

**Write tests that discriminate.** The single most common defect in Stage 1 was tests
that pass against a badly broken implementation: index tests using only one user, a
redaction test matching a substring, seed tests counting rows without checking
*which* rows. Before trusting a test, ask what broken implementation would still pass
it — and if you can't name one, the test may not be doing anything. Several times the
fix was proven by deliberately breaking the code and watching the test go red. Do that.

**Services throw `DomainError` subclasses** (`NotFoundError`, `ForbiddenError`,
`ConflictError`, `UnprocessableError`), never `@nestjs/common` exceptions. The global
filter turns them into RFC 9457 Problem Details.

**Write through `TransactionHost`, not `PrismaService`.** `host.tx` returns the
ambient transaction if one is open. `host.run(fn)` starts one or *joins* the caller's
— deliberately no savepoint, so an inner failure can't be swallowed while the outer
action commits. This is what makes "the audit row is written in the same transaction
as the action" structural instead of something you have to remember.

**Status columns:** from Stage 6 onward every transition goes through a single
per-entity transition function. Nothing exists yet — you'll build the first one.

---

## Known gaps, in the order I'd fix them

1. **Add an ESLint boundary rule banning `PrismaService` injection outside
   `src/prisma/`.** `PrismaService` has to stay injectable (the transaction host
   depends on it), so right now nothing stops a service bypassing `TransactionHost`
   and writing outside the ambient transaction. The audit guarantee is currently
   convention, not structure. **Cheapest to do before Stage 2's services multiply.**

2. **`req.url` is logged unredacted, query string included.** `LOG_REDACT_PATHS`
   covers cookies, auth headers, `req.query.token`, `req.query.code` and
   `set-cookie` — but not the raw URL. Harmless today; a live token leak the moment
   Stage 3 puts invitation tokens in links. Also `problem.filter.ts` logs
   `{ err }` on 5xx, and Prisma validation errors embed the failing call's
   arguments.

3. **CI has never actually run.** The workflow exists and its exact seven commands
   pass locally, but nothing has been pushed, so it's unexercised on a Linux runner.
   One green run is the only real evidence.

4. **Extract a shared `test/factories.ts`.** `uniq()`, `aUser()` and `aClub()` are
   duplicated across the schema test files. Stage 2 needs them anyway.

5. **Register the Problem Details schemas in the OpenAPI document.** They're
   imported only as types, so the generated spec documents no error shape. Needs
   routes that declare error responses.

6. **Replace the seed's placeholder password hash** with real argon2id when auth
   lands. `DEV_PASSWORD_HASH` is labelled `SEED-ONLY-NOT-A-REAL-HASH`; the seeded
   accounts cannot currently be logged into.

---

## Settled decisions — don't re-litigate without asking

Spec §3 holds the full ledger with reasoning. The ones most likely to get
accidentally reversed:

- **No approval workflow anywhere.** Admin creates club → active. Lead publishes
  event → live. No pending states, no `ApprovalDecision` entity.
- **One QR pass per user**, not per registration. It carries identity only — the
  server resolves the registration for the scanned event. Rotation exists.
- **Public certificate verification exists** (`/verify/{code}`).
- **Subjects get foreign keys; actors don't.** `userId` on a membership is a real FK;
  `invitedById`, `checkedInById`, `auditLog.actorUserId` etc. are bare UUIDs, so the
  record of who did something outlives their account.
- **`AuditLog` is append-only**, enforced by statement-level triggers. It has no
  foreign keys at all — a FK would force a cascade or a `SET NULL`, and `SET NULL`
  is an `UPDATE` the trigger must refuse. Note `TRUNCATE` is deliberately *not*
  blocked; the test harness depends on it.
- **English only. Single university.** Timestamps stored UTC; events carry an IANA
  timezone and render in the venue's zone with the viewer's as secondary.
- **Deployment is Vercel for both apps**, with the lazy event lifecycle making cron
  granularity irrelevant. Nothing is deployed yet.

---

## Note for whoever set this up

**There is no `CLAUDE.md` in this repo.** The abandoned previous build at
`../majlis` has one, but none of it applies here — different stack, different
decisions, and several of its rules are now actively wrong (it describes Hono on
Cloudflare Workers with Drizzle, and says certificate verification and QR rotation
don't exist; both exist here). **Don't read it.** Consider writing a fresh
`CLAUDE.md` for this repo that points at the spec and the gotchas above, so future
sessions get them without relying on this handoff surviving.
