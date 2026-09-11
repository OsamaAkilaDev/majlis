# Handoff

**Written:** 2026-09-11, after Stage 2 shipped.
`CLAUDE.md` holds the durable rules. Delete this file once its gaps are actioned.

---

## State

Stages 1 and 2 complete and merged to `master`. Nothing pushed — no remote exists.

| | |
|---|---|
| Tests | 125 unit, 184 integration, all green against real PostgreSQL 18 |
| Migrations | 7 |
| HTTP surface | `/health`, `/docs`, `/auth/{signup,login,refresh,logout,me}`, `/me`, `/users`, `/users/{id}/status` |

Seeded accounts now log in: `admin@uni.ac.ae` / `lead@` / `ops@` / `student@`, password `Passw0rd!`.

**Next: Stage 3 — design system & shells.** Spec §13.

---

## Read order

1. `docs/specs/2026-09-10-majlis-design.md` — binding. §13 has stage progress and every deviation.
2. `docs/specs/2026-09-11-stage-2-auth-design.md` — how auth actually works.
3. The stage plan in `docs/superpowers/plans/`.

---

## Run it

```bash
cp .env.example .env        # first — postinstall needs DIRECT_URL
pnpm install
pnpm --filter @majlis/api prisma:deploy
pnpm --filter @majlis/api db:seed
pnpm --filter @majlis/api start:dev
```

Needs PostgreSQL 18 on `localhost:5432`, databases `majlis_dev` / `majlis_test`.
`pnpm db:check` confirms. CI sequence:

```bash
pnpm typecheck && pnpm lint && pnpm test
pnpm --filter @majlis/api test:integration
pnpm build
```

---

## Gaps, in the order I'd fix them

1. **`trust proxy` is not set — resolve during Stage 3.** Spec §9.2 puts a Next.js
   rewrite in front of the API. The moment it lands, `req.ip` is the platform proxy for
   every caller: login throttling becomes 5 failed attempts per minute *for the whole
   university*, and `audit_log.ip` / `refresh_token.ip` record the proxy instead of the
   client. Do not blindly enable `trust proxy: true` either — that makes
   `X-Forwarded-For` spoofable. Set it to the specific hop count Vercel guarantees.

2. **`req.url` logged unredacted, and `{ err }` logged on 5xx.** Harmless today. A live
   token leak the moment Stage 4 puts invitation tokens in links.

3. **CI has never run.** The workflow exists and passes locally; nothing has been pushed,
   so it is unexercised on a Linux runner. One green run is the only real evidence.

4. **No password reset, no email verification — anywhere in the spec.** A student who
   forgets their password has no recovery path and an admin cannot give them one. Needs
   a product decision before Stage 10 fixes the notification patterns in place.

5. **OpenAPI has no success-response schemas.** Adding the `@ApiResponse` error
   declarations displaced Nest's auto-generated defaults. Errors are documented; 200s
   are not.

---

## Things that will bite you

Beyond `CLAUDE.md`'s toolchain traps, all verified the hard way in Stage 2:

- **Throwing inside `host.run()` rolls back everything, including the audit row.** The
  client still sees a correct 4xx, so it looks fine. Refresh reuse detection shipped
  broken this way and was caught only by a test asserting the family was actually dead.
  If a path writes then throws, return a result and throw after the transaction commits
  — see `auth.service.ts`'s refresh flow.
- **Nest stops at the first guard that denies.** A controller-scoped `ThrottlerGuard`
  never runs if a global guard denies first. That is why `ThrottlerGuard` is global and
  ordered ahead of `PermissionsGuard`.
- **Prisma raises `P2007`, not `P2023`, for a malformed UUID** with `@prisma/adapter-pg`.
  Both are mapped to 400 in `problem.filter.ts`.
- **Zod 4's `.url()` does not restrict the scheme.** It accepts `javascript:` and
  `data:text/html`. Any user-supplied URL needs an explicit scheme allowlist.
- **`z.email().trim()` validates before trimming.** Use `z.string().trim().email()`.
- **`user.email` is `TEXT` with `CHECK (email = lower(email))`, not citext.** Normalise
  on lookup as well as insert — the insert fails loudly, the lookup fails silently as
  "wrong password".
- **Guards run outside the request's transaction.** An audit row written in a guard needs
  its own `host.run()`.

---

## On process

Stage 2 took about six hours and that was too long. The rigor found six real defects —
three of them in the plan rather than the code — but cost four agent dispatches per task,
many of them fix rounds over comment wording.

For Stage 3 onward: one review per task, not review-plus-fix-plus-re-review. Minor
findings go on a list for the final review to triage. Batch small same-shape tasks into
one dispatch. Keep code comments to a line or two. What stays non-negotiable is tests
that discriminate, invariants in the database, and a security review before auth, token
or permission code lands — the speed comes out of ceremony, not out of correctness.

The recurring defect in both stages has been **tests that pass against badly broken
code**. Stage 2's review caught one on nine of twelve tasks. Before trusting a test, name
the broken implementation it would catch; if you cannot, it is not testing anything.
