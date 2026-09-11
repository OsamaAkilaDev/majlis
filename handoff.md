# Handoff

**Written:** 2026-09-11, after Stage 2.
`CLAUDE.md` holds the durable rules. Delete this once its gaps are actioned.

---

## State

Stages 1 and 2 complete, merged to `master`. Nothing pushed — no remote exists.

| | |
|---|---|
| Tests | 125 unit, 174 integration, all green against real PostgreSQL 18 |
| Migrations | 7 |
| API | `/health` · `/docs` · `/auth/{signup,login,refresh,logout,me}` · `/me` · `/users` · `/users/{id}/status` |
| Frontend | **None yet.** `apps/web` does not exist. |

Seeded accounts log in: `admin@` / `lead@` / `ops@` / `student@uni.ac.ae`, password `Passw0rd!`.

**Next: Stage 3 — design system & shells.**

The plan is now **9 stages, not 12** (renumbered 2026-09-11). No feature was dropped; the
old 4+5, 6+7 and 10+11 merged because each pair is coupled. Spec §13 has the table.

---

## Read order

1. `docs/specs/2026-09-10-majlis-design.md` — binding. §9 is the frontend brief, §13 the stages.
2. `docs/specs/2026-09-11-stage-2-auth-design.md` — how auth works (amended after delivery).
3. This file.

---

## Run it

```bash
cp .env.example .env        # first — postinstall needs DIRECT_URL
pnpm install
pnpm --filter @majlis/api prisma:deploy
pnpm --filter @majlis/api db:seed
pnpm --filter @majlis/api start:dev      # :3001
```

Needs PostgreSQL 18 on `localhost:5432`, databases `majlis_dev` / `majlis_test`.
`pnpm db:check` confirms. Before claiming anything works:

```bash
pnpm typecheck && pnpm lint && pnpm test
pnpm --filter @majlis/api test:integration
pnpm build
```

---

## What Stage 3 has to build

Spec §9. In short: `apps/web` (Next.js 16, App Router), the visual identity, and three
shells — student (mobile-first, bottom tabs), club officer console, admin desktop.

The API contract you are building against:

- Auth is **cookie-based**, `httpOnly`. The browser never sees a token. `majlis_session`
  (15 min, `Path=/`) and `majlis_refresh` (30 days, `Path=/api/v1/auth`).
- On a 401, call `POST /api/v1/auth/refresh` once and retry. **No client-side dedupe is
  needed** — the refresh token does not rotate, so concurrent refreshes are harmless.
- `GET /api/v1/auth/me` returns `{ id, email, fullName, avatarUrl, platformRole, clubRoles }`.
  That is what `/` routes on: `ADMIN` → `/admin`, officer-only → their club console,
  otherwise `/home`. `clubRoles` is empty until Stage 4.
- Errors are RFC 9457 `application/problem+json` with `type/title/status/detail/requestId`
  and an `errors[]` array on validation failures. Drive inline field errors off `errors[]`.
- OpenAPI at `/api/v1/docs`, JSON at `/api/v1/docs-json`. Error shapes are documented;
  **success-response schemas are not** (see gaps).
- A Next.js rewrite maps `/api/v1/*` to the API so the browser sees one origin. Do this —
  it is what makes the cookie first-party and removes CORS entirely.

**Never render a page then show an "authentication required" panel inside it. Redirect.**

---

## Gaps, in the order I would fix them

1. **No rate limiting anywhere.** Removed by owner decision; Stage 9 owns all of it. Login
   is unthrottled — argon2id's ~100ms cost is the only brake on brute force. When Stage 9
   adds it, set `trust proxy` **first**: behind the Next.js rewrite every caller shares one
   `req.ip`, so an IP-keyed limit would throttle the whole university at once. Do not use
   `trust proxy: true` — that makes `X-Forwarded-For` spoofable.
2. **`req.url` is logged unredacted**, and `problem.filter.ts` logs `{ err }` on 5xx. Close
   before Stage 4 puts invitation tokens in links.
3. **CI has never run.** The workflow exists and passes locally; nothing has been pushed.
   One green run on a Linux runner is the only real evidence.
4. **No password reset, no email verification — anywhere in the spec.** A student who
   forgets their password has no recovery path and an admin cannot give them one. Needs a
   product decision before Stage 8 fixes the notification patterns in place.
5. **OpenAPI has no success-response schemas.** Adding the `@ApiResponse` error
   declarations displaced Nest's auto-generated defaults.

---

## Two deliberate simplifications (2026-09-11)

Both at the owner's direction, after Stage 2 landed. Neither is an oversight — do not
"restore" them:

- **Refresh tokens do not rotate.** One opaque token per login, revoked on logout and on
  suspension, expiring 30 days after login regardless of activity. A stolen refresh token
  works until it expires or the session is revoked. Rotation with family-wide reuse
  detection existed and was removed as disproportionate.
- **No rate limiting.** `@nestjs/throttler` removed entirely; Stage 9 owns it.

The schema keeps `family_id` (identifies one login's session, used by logout) and
`replaced_by` (now unused — dropping it needs a migration for no gain).

---

## Things that will bite you

Beyond `CLAUDE.md`'s toolchain traps, all verified the hard way:

- **Throwing inside `host.run()` rolls back everything, including the audit row.** The
  client still sees a correct 4xx, so it looks fine. Reuse detection shipped broken this
  way. If a path writes then throws, return a result and throw after the transaction
  commits.
- **Nest stops at the first guard that denies.** A controller-scoped guard never runs if a
  global one denies first.
- **Prisma raises `P2007`, not `P2023`, for a malformed UUID** with `@prisma/adapter-pg`.
  Both map to 400 in `problem.filter.ts`.
- **Zod 4's `.url()` does not restrict the scheme** — it accepts `javascript:` and
  `data:text/html`. Any user-supplied URL needs an explicit allowlist.
- **`z.email().trim()` validates before trimming.** Use `z.string().trim().email()`.
- **`user.email` is `TEXT` with `CHECK (email = lower(email))`.** Normalise on lookup as
  well as insert — the insert fails loudly, the lookup fails silently as "wrong password".
- **Guards run outside the request's transaction.** An audit row written in a guard needs
  its own `host.run()`.

---

## On process — read this before starting

Stage 2 took about six hours and that was too long. The owner's feedback, verbatim:
*"too many comments and too long"*, *"more efficient and more productive while not losing
quality"*.

What cost the time: four agent dispatches per task (implement → review → fix → re-review)
across twelve tasks, many of those fix rounds over comment wording. What it bought: six real
defects, three of them in the plan rather than the code.

**For Stage 3 onward:**

- One review per task. Not review-plus-fix-plus-re-review. Minor findings go on a list the
  final review triages.
- Batch small same-shape tasks into one dispatch.
- Code comments: one or two lines, explaining *why* only where a reader would otherwise
  undo it. No essays about library behaviour — that goes in the commit message, once.
- Commit messages: subject plus two or three lines.
- Keep replies to the owner short. Lead with the answer.

**What does not get traded away:** tests that discriminate, invariants in the database, a
security review before auth/token/permission code lands. The speed comes out of ceremony,
not out of correctness.

The recurring defect across both stages has been **tests that pass against badly broken
code** — Stage 2's review caught one on nine of twelve tasks. Before trusting a test, name
the broken implementation it would catch. If you cannot, it is not testing anything.
