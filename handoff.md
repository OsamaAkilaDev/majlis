# Handoff

**Written 2026-09-12, after Stage 5.** `CLAUDE.md` holds the durable rules. Delete this once its gaps are actioned.

---

## State

Stages 1 to 5 complete. Stage 5 is on `stage-5-events-registration`. Nothing pushed; no remote exists.

| | |
|---|---|
| Tests | 320 API integration, 139 API unit, 52 contracts, 115 web unit, 134 Playwright/axe |
| Migrations | 9 |
| API | auth, users, departments, clubs, team, invitations, membership, events, registrations |
| Frontend | three shells, each working at desktop and phone width |

Seeded logins: `admin@` / `lead@` / `ops@` / `student@uni.ac.ae`, password `Passw0rd!`.
Seeded clubs: `robotics-club` (APPROVAL_REQUIRED) and `chess-club` (CLOSED, which exists so
the axe suite always has a disabled join control). Seeded event `robotics-showcase` has
capacity 1, already taken, waitlist off, so the refused register state is always scannable.

**Next: Stage 6, attendance and certificates.**

---

## Read order

1. `docs/specs/2026-09-10-majlis-design.md`. Binding. §13 has the stages, the completion
   notes, and **"How a stage is built"**, which is the process and the most important thing
   to read before starting.
2. The Stage 5 completion note in §13, for what events and registration actually do.
3. This file.

---

## Run it

```bash
cp .env.example .env        # then paste the Supabase values
pnpm install
pnpm --filter @majlis/api prisma:deploy
pnpm --filter @majlis/api db:seed
pnpm --filter @majlis/api start:dev      # :3001
pnpm --filter @majlis/web dev            # :3000
```

Needs PostgreSQL 18 on `localhost:5432`, database `majlis_dev`. `pnpm db:check` confirms.

Before claiming anything works:

```bash
pnpm typecheck && pnpm lint && pnpm test
pnpm --filter @majlis/api test:integration
API_ORIGIN=http://localhost:3001 pnpm build
pnpm --filter @majlis/web test:e2e       # needs both servers up
```

**`.env` is six values now.** Stage 5 added `LIFECYCLE_SWEEP_SECRET`, which has a
development default and is refused in production, mirroring `SESSION_SECRET`.

---

## Things that will bite you

**New in Stage 5:**

- **Never edit an applied migration file, including its comments.** Prisma stores the
  file's hash. `migrate deploy` ignores a mismatch; `migrate dev` refuses to run at all and
  offers to drop your database. Commit `9f84214` did exactly this and its message claimed
  "no checksum concerns". Both databases are repaired; the trap is not.
- **A constant imported from a `'use client'` module reaches a Server Component as a client
  reference, not its value.** `limit=${PAGE}` became `limit=[object Object]`, the API
  answered 400, and eight screens silently kept their skeletons with typecheck, lint and
  every test green. `lib/page-size.ts` exists because of this.
- **A default argument that reads the runtime environment is a hydration bomb.**
  `eventTimes(..., viewerZone = viewerTimeZone())` rendered Asia/Dubai on the server and the
  viewer's zone in the browser. React answers a text mismatch by regenerating the whole tree
  client-side, silently undoing every server render for viewers outside the server's zone.
  `lib/use-viewer-zone.ts` supplies it explicitly instead.
- **Express leaves `req.body` undefined when a request carries no body**, so a plain object
  schema turns every bodyless `POST` and `DELETE` into a 400. Override bodies are
  `.optional().default({})`.
- **A long-lived `next dev` balloons past Node's ~4GB heap** and starts failing to compile
  routes, which surfaces in Playwright as `element(s) not found`. One reached 4,865 MB after
  3.5 hours. Restart it between e2e runs; never trust a result from an old server.
- **Do not return an in-flight request promise from a Prisma `$transaction` callback.**
  Prisma awaits it before committing, which deadlocks to the 5s timeout. That is the shape
  the two deterministic concurrency tests need.

**From Stage 4, still true:**

- **`e.meta?.target` is always empty.** Under `@prisma/adapter-pg` a `P2002` carries the
  constraint at `meta.driverAdapterError.cause.constraint.index`. Use `violatedConstraintName`.
- **Assert the message, not just the status.** It is the only reason the dead conflict
  branches were ever found.
- **A Radix `SelectTrigger` is a `<button>`**, and `<label htmlFor>` cannot bind to one.
  Every select needs its own `aria-label`.
- **`PermissionsGuard` reads the scope id from the literal path you pass it**, so a route
  parameter named `:id` under `from: 'params.clubId'` resolves no scope and denies a real
  Lead silently.
- **A club-scoped permission cannot authorize a bare row id.** Nest the route and load the
  row with both ids.
- **Throwing inside `host.run()` rolls back everything**, including a write you meant to keep.
- **`text-ink-muted` is not a token**; only `text-ink-2` is. It shipped on three screens and
  rendered nothing.

---

## Gaps, in the order I would fix them

1. **No `error.tsx` anywhere in `apps/web`, Stage 6, and it is user-visible.** Every client
   `load()` effect rejects unhandled on a non-404/403 error, so a revoked refresh token
   mid-session leaves the screen on its skeleton forever.
2. **`__Host-` cookie prefix, Stage 8, blocking.** Needs a development-mode `Secure`
   decision first, or it breaks the dev loop and the Playwright suite.
3. **No rate limiting anywhere.** Stage 8 owns it. Set `trust proxy` first, and never
   `trust proxy: true`.
4. **CI has never run.** No remote exists. One green run is still the only real evidence.
5. **`GET /events?q=` is a sequential scan.** Needs `pg_trgm`, which changes the
   deployment's database requirements. A decision, not a fix.
6. **No password reset, no email verification, anywhere in the spec.** Needs a product
   decision before Stage 7.
7. **Orphaned uploads accumulate**, and no image can be deleted at all.
8. **OpenAPI has no success-response schemas.**

---

## Deliberate simplifications, do not "restore" them

- **Refresh tokens do not rotate.** One opaque token per login, revoked on logout and suspension.
- **No rate limiting.** `@nestjs/throttler` removed entirely.
- **No `(public)` route group.** No landing page, no anonymous browsing.
- **Invitations have no tokens and no links** until Stage 7 adds email.
- **`INVITE_ONLY` means an officer adds the member directly.** No membership invitation entity.
- **No Supabase SDK.** Two REST calls via `fetch`.
- **`eligibilityRules` stays null.** `User` carries neither department nor year, so §7.4's
  department and year rules have nothing to evaluate. Eligibility is
  `requiresClubMembership` plus account and club status.
- **A reopened registration window is refused, not honoured.** The lazy lifecycle is
  forward-only, and reopening needs an explicit product decision.
- **Both halves of the sweep's skip logic are kept** even though either alone leaves the
  test green: the candidate filter avoids a transaction per stale row, the result comparison
  keeps the reported count honest. A minimalism pass will want to cut one.

---

## On process

Stage 5 ran as §13 prescribes: two dispatches and one review, rather than Stage 4's twelve
task-level cycles. That worked, and the whole-branch review is what earned it. It found
fourteen issues, including a secret in the logs, a field-permission bypass on the poster
upload, and a regression that a fix earlier in the same stage had introduced into a Stage 4
screen. A per-task review could not have found that last one, because it compares code to
its own task and never the stage to the spec.

Two rules are worth more than any amount of extra testing, and both paid out again here:
**delete the code a test guards and confirm it goes red**, and **assert the response detail
message, not only the status code.**
