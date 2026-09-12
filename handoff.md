# Handoff

**Written 2026-09-12, after Stage 4.** `CLAUDE.md` holds the durable rules. Delete this once its gaps are actioned.

---

## State

Stages 1 to 4 complete. Stage 4 is on `stage-4-clubs-team-membership`, not yet merged to `master`. Nothing pushed; no remote exists.

| | |
|---|---|
| Tests | 269 API integration, 125 API unit, 48 contracts, 91 web unit, 74 Playwright/axe |
| Migrations | 7, unchanged this stage |
| API | auth, users, departments, clubs, team, invitations, membership |
| Frontend | three shells with real screens: admin, officer console, student |

Seeded logins: `admin@` / `lead@` / `ops@` / `student@uni.ac.ae`, password `Passw0rd!`. Two seeded clubs: `robotics-club` (APPROVAL_REQUIRED) and `chess-club` (CLOSED, which exists so the axe suite always has a disabled join control to scan).

**Next: Stage 5, events and registration.**

---

## Read order

1. `docs/specs/2026-09-10-majlis-design.md`. Binding. §13 has the stages, the completion notes, and **"How a stage is built"**, which is the revised process and the most important thing to read before starting.
2. `docs/specs/2026-09-12-stage-4-clubs-team-membership-design.md` for how clubs and membership work.
3. This file.

---

## Run it

```bash
cp .env.example .env        # then paste the Supabase values, see below
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

**`.env` is now five values.** `DATABASE_URL`, `SESSION_SECRET`, `SUPABASE_STORAGE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `LOG_LEVEL`. `DIRECT_URL`, `TEST_DATABASE_URL` and `SHADOW_DATABASE_URL` are derived from `DATABASE_URL` and only need setting when they differ, which on Supabase means `DIRECT_URL` (the pooler cannot run migrations).

**The Supabase bucket is `majlis-storage`, public.** Two settings live in the Supabase dashboard, not in code, and they are the real enforcement for uploads: a 2 MB size limit and `image/webp` as the only allowed MIME type. Confirm they are set. Without them, the browser-side conversion is a convention rather than a rule.

---

## What Stage 4 left you

**Images.** One bucket, folders per resource: `clubs/<id>/logo.webp`, `clubs/<id>/banner.webp`. Reserved and already agreed: `events/<id>/poster.webp`, `users/<id>/avatar.webp`, `site/<name>.webp`. The browser converts to WebP and PUTs to a signed URL; the API never sees the bytes and verifies the object before storing a URL. Add a kind by extending `IMAGE_KINDS` in `packages/contracts/src/clubs/index.ts` and `PATHS` in `apps/api/src/storage/image-kinds.ts`. Stored URLs carry `?v=<epoch>` so a replacement is a distinct URL.

**Permissions.** `PERMISSIONS` in `apps/api/src/auth/permissions.ts` is pure data and gained six rows without the guard changing. Stage 5 adds event rows the same way.

**Field-level permissions do not exist and Stage 5 owes them.** Spec §6.1 gives Marketing "public fields" and CTO "technical fields" on both clubs and events. Stage 4 deferred it because events need the identical mechanism. Build it once, in Stage 5, and apply it to clubs at the same time.

---

## Things that will bite you

**From Stage 4:**

- **`e.meta?.target` is always empty.** Prisma 7 requires a driver adapter, and under `@prisma/adapter-pg` a `P2002` carries the constraint at `meta.driverAdapterError.cause.constraint.index`, not `meta.target`. Use `violatedConstraintName` from `apps/api/src/common/prisma-constraint.ts`. Three services had dead conflict-mapping branches for three stages because of this, and every test passed: the global Problem Details filter maps a stray `P2002` to a generic 409, so the status codes were right and only the messages were wrong.
- **Assert the message, not just the status.** That is the only reason the above was found. A status code proves the invariant; the detail text proves the code path.
- **`lib/api.ts` fetches a relative path**, which has no origin in a Server Component. Every screen that loads data is a Client Component. Only `lib/session.ts` fetches server-side, and it uses `API_ORIGIN` explicitly.
- **A Radix `SelectTrigger` is a `<button>`, and `<label htmlFor>` cannot bind to a button.** Every select needs its own `aria-label`; `Field`'s label renders but associates with nothing. Six shipped nameless and axe called it critical.
- **`PermissionsGuard` reads the scope id from a literal path** you pass it, so a route parameter named `:id` under `from: 'params.clubId'` resolves no scope and denies a real Lead with no type error and no failing test. Use `:clubId` on every club-scoped route.
- **A club-scoped permission cannot authorize a bare row id.** `DELETE /clubs/:clubId/team/:appointmentId` is nested for that reason, and the handler must also load the row with `where: { id, clubId }` or the Lead of club A can act on club B's rows.
- **Throwing inside `host.run()` rolls back everything, including a write you meant to keep.** Marking an invitation `EXPIRED` and then throwing leaves it `INVITED` forever. Return a discriminated result and throw outside the transaction.
- **Verify a wire format against the live service.** Supabase Storage returns HTTP 400, not 404, for a missing object, with a body that says 404. Written from memory, `statObject` would have thrown on every missing upload.
- **Bash backtick command substitution eats template literals** when editing TypeScript through a heredoc. Use the Edit tool or a script file.

**From Stages 1 to 3:** see git history and `CLAUDE.md`. The ones that still bite most: `NextResponse.next()` forwards the original cookie header; `res.cookies.delete(name)` with no path uses RFC 6265 default-path; Zod 4's `.url()` does not restrict the scheme; `z.email().trim()` validates before trimming; Prisma raises `P2007`, not `P2023`, for a malformed UUID.

---

## Gaps, in the order I would fix them

1. **`__Host-` cookie prefix, Stage 8, blocking.** Widening `majlis_refresh` to `Path=/` removed the protection RFC 6265 path ordering gave against sibling-subdomain shadowing. The prefix requires `Secure`, and `secureCookies()` returns false in development, so adding it as-is breaks the dev loop and the Playwright suite. Decide development-mode `Secure` first.
2. **No rate limiting anywhere.** Stage 8 owns it. Set `trust proxy` first: behind the Next.js rewrite every caller shares one `req.ip`, so an IP-keyed limit throttles the whole university at once. Never `trust proxy: true`, which makes `X-Forwarded-For` spoofable.
3. **CI has never run.** No remote exists. The workflow has `verify` and `e2e` jobs and both carry Stage 4's two Supabase placeholders so the API can boot. One green run is still the only real evidence.
4. **Orphaned uploads accumulate.** An abandoned club creation leaves a few hundred KB at `clubs/<unused-id>/logo.webp`. No sweep exists.
5. **No password reset, no email verification, anywhere in the spec.** A student who forgets their password has no recovery path. Needs a product decision before Stage 7.
6. **OpenAPI has no success-response schemas.** Adding `@ApiResponse` error declarations displaced Nest's auto-generated defaults.
7. **The slug-collision branch of `ClubsService.mapWriteError` has no test.** Five genuine concurrent attempts never opened the race window. Left unverified rather than contrived.

---

## Deliberate simplifications, do not "restore" them

- **Refresh tokens do not rotate.** One opaque token per login, revoked on logout and suspension.
- **No rate limiting.** `@nestjs/throttler` removed entirely.
- **The account menu is `modal={false}`.** Radix marked the shell `aria-hidden` while the bottom tab bar stayed focusable, a real WCAG 4.1.2 failure.
- **No `(public)` route group.** No landing page, no anonymous browsing.
- **Invitations have no tokens and no links.** `ClubTeamAppointment.invitationTokenHash` is written by nothing and stays null until Stage 7 adds email. `invitationExpiresAt` is used, and expiry is evaluated lazily on read.
- **`INVITE_ONLY` means an officer adds the member directly.** There is no membership invitation entity.
- **No Supabase SDK.** Two REST calls via `fetch` in `apps/api/src/storage/storage.service.ts`.

---

## On process

Stage 4 was correct and far too slow: twelve tasks, each with a dispatch, a review and usually a fix round. **Read §13's "How a stage is built" before starting Stage 5.** It is two dispatches and one review per stage.

What the reviews actually earned, so you know what not to cut: eight tests that could not fail, one production bug dead in three services, an archived club still approving memberships, a `GET /me/clubs` that listed a rejoined club twice, and a policy that made two of four membership policies identical. What they cost: roughly two thirds of the stage.

The cheapest version of that value is a single review at the end of a stage, asked for exploitable defects only, plus this rule when writing any test: **delete the code it guards and confirm it goes red.** Every defect above was found by that question, not by more tests.
