# Handoff

Point-in-time state. **`CLAUDE.md` holds the durable rules** — the ground rules,
toolchain traps, skills to use, and settled decisions all live there, so they survive
this file being deleted.

**Written:** 2026-09-11, after Stage 1 shipped.
**Delete this file once its known-gaps list has been actioned or moved into the spec.**

---

## Where things stand

**Stage 1 (Foundation) is complete and merged to `master`.** 66 commits, clean tree,
nothing pushed anywhere.

| | |
|---|---|
| Tests | 32 unit, 100 integration — all green against real PostgreSQL 18 |
| Migrations | 7 applied |
| HTTP surface | `GET /api/v1/health` and `/api/v1/docs` only. **No auth, no business endpoints yet.** |
| Remote | **None.** Nothing published; that's the human's call. |

**Stage 2 is next: auth and users** — signup, login, refresh rotation with reuse
detection, the session guard, the permission guard skeleton, user suspension. Spec
§13 has the full twelve-stage sequence.

---

## Getting running

```bash
cp .env.example .env               # must come first: postinstall needs DIRECT_URL
pnpm install                       # postinstall runs prisma generate
pnpm --filter @majlis/api prisma:deploy
pnpm --filter @majlis/api db:seed
pnpm --filter @majlis/api start:dev
```

Needs PostgreSQL 18 on `localhost:5432` with role `majlis` and databases
`majlis_dev` / `majlis_test`. `scripts/bootstrap-db.sql` creates the role;
`pnpm db:check` confirms connectivity.

What CI runs, and what to run before claiming anything works:

```bash
pnpm install --frozen-lockfile
pnpm --filter @majlis/api prisma:generate
pnpm typecheck && pnpm lint && pnpm test
pnpm --filter @majlis/api test:integration
pnpm build
```

---

## Known gaps, in the order I'd fix them

1. **Add an ESLint boundary rule banning `PrismaService` injection outside
   `src/prisma/`.** `PrismaService` has to stay injectable — the transaction host
   depends on it — so nothing currently stops a service bypassing `TransactionHost`
   and writing outside the ambient transaction. The audit guarantee is convention,
   not structure. **Cheapest before Stage 2's services multiply.**

2. **`req.url` is logged unredacted, query string included.** `LOG_REDACT_PATHS`
   covers cookies, auth headers, `req.query.token`, `req.query.code` and
   `set-cookie` — not the raw URL. Harmless today; a live token leak the moment
   Stage 3 puts invitation tokens in links. Also `problem.filter.ts` logs `{ err }`
   on 5xx, and Prisma validation errors embed the failing call's arguments.

3. **CI has never actually run.** The workflow exists and its seven commands pass
   locally, but nothing has been pushed, so it is unexercised on a Linux runner.
   One green run is the only real evidence.

4. **Extract a shared `test/factories.ts`.** `uniq()`, `aUser()` and `aClub()` are
   duplicated across the schema test files. Stage 2 needs them anyway.

5. **Register the Problem Details schemas in the OpenAPI document.** They are
   imported only as types, so the generated spec documents no error shape. Needs
   routes that declare error responses.

6. **Replace the seed's placeholder password hash** with real argon2id when auth
   lands. `DEV_PASSWORD_HASH` is labelled `SEED-ONLY-NOT-A-REAL-HASH`; the seeded
   accounts cannot currently be logged into.

---

## Worth knowing about Stage 1's construction

It was built with `superpowers:subagent-driven-development` — a fresh agent per task,
reviewed between each. Forty-one decisions were made without the human present; the
consequential ones are recorded as deviations in spec §13.

The recurring defect, caught seven separate times, was **tests that pass against a
badly broken implementation**: index tests exercising only one user, a redaction test
matching a substring, seed tests counting rows without checking which rows. The worst
would have allowed exactly one check-in per event, forever, with every test green.
Expect to find more of them and write new ones defensively — `CLAUDE.md` says how.
