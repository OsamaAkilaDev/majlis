# Handoff

**Written:** 2026-09-12, after Stage 3.
`CLAUDE.md` holds the durable rules. Delete this once its gaps are actioned.

---

## State

Stages 1, 2 and 3 complete. Stage 3 lives on `stage-3-design-system-shells`, 22 commits,
not yet merged to `master`. Nothing pushed anywhere; no remote exists.

| | |
|---|---|
| Tests | 91 web unit, 95 API unit, 176 API integration, 50 Playwright/axe. All green |
| Migrations | 7 |
| API | `/health` `/docs` `/auth/{signup,login,refresh,logout,me}` `/me` `/users` `/users/{id}/status` |
| Frontend | `apps/web`: three shells, working auth, PWA manifest, axe suite |

Seeded accounts log in: `admin@` / `lead@` / `ops@` / `student@uni.ac.ae`, password `Passw0rd!`.
Re-seeding now repairs password hashes and event capacity; it previously could not.

**Next: Stage 4, clubs, team and membership.**

---

## Read order

1. `docs/specs/2026-09-10-majlis-design.md`: binding. §13 has the stages and the completion notes.
2. `docs/specs/2026-09-11-stage-3-shells-design.md`: the design system, tokens, and §10's six deviations.
3. `docs/specs/2026-09-11-stage-2-auth-design.md`: how auth works.
4. This file.

---

## Run it

```bash
cp .env.example .env        # first, postinstall needs DIRECT_URL
pnpm install
pnpm --filter @majlis/api prisma:deploy
pnpm --filter @majlis/api db:seed
pnpm --filter @majlis/api start:dev      # :3001
pnpm --filter @majlis/web dev            # :3000
```

Needs PostgreSQL 18 on `localhost:5432`, databases `majlis_dev` / `majlis_test`.
`pnpm db:check` confirms. Before claiming anything works:

```bash
pnpm typecheck && pnpm lint && pnpm test
pnpm --filter @majlis/api test:integration
API_ORIGIN=http://localhost:3001 pnpm build
pnpm --filter @majlis/web test:e2e       # needs both servers up
```

**`pnpm build` now requires `API_ORIGIN`.** `next build` runs with `NODE_ENV=production`,
which trips the guard that stops a production deploy silently pointing at localhost.

---

## What Stage 3 left for you

### Design system

All 24 tokens live in `apps/web/src/styles/globals.css` as runtime custom properties,
aliased through `@theme inline`. `tokens.contrast.test.ts` recomputes every WCAG ratio from
the shipped values on every test run, so a palette regression fails the build.

Two border tokens, and the distinction is load-bearing: `--color-border` is decorative and
has no contrast requirement; `--color-border-control` is the boundary of an input or
checkbox, is held to 3:1 against all three grounds for SC 1.4.11, and is the only border
token a form control may use. The first palette pass failed that at 1.79:1 in both themes.

Motion comes from `--dur`, `--dur-fast` and `--ease-out`, which already collapse to
`0.01ms` under `prefers-reduced-motion`. Never hardcode a duration and never add your own
reduced-motion media query; you get it free by using the tokens.

`EmptyState` and `Field` deliberately have **no** `description` prop. That absence is how
the copy rule is enforced rather than reviewed. Do not add one.

### Accessibility

`apps/web/e2e/a11y.spec.ts` runs axe over login, the student shell, both consoles, a refusal
page, the account menu while open, and the nav sheet while open, in both themes at two
viewports. The suite is verified to discriminate: removing `htmlFor` from a label makes both
themes fail on WCAG 4.1.2.

**If axe reports a violation, fix the markup.** Do not narrow the tag list, add exclusions,
or scope the scan. That converts verification back into assertion, which spec §9.5 rejects.

---

## Gaps, in the order I would fix them

1. **`__Host-` cookie prefix, Stage 9, and treat it as blocking.** Widening `majlis_refresh`
   to `Path=/` removed the accidental protection RFC 6265 path ordering gave against a
   sibling-subdomain shadowing attack. Renaming both cookies to `__Host-` fixes it, but not
   as a two-line change: the prefix requires `Secure`, and `secureCookies()` deliberately
   returns false in development, so adding it as-is makes the browser reject both cookies and
   breaks the dev loop and the Playwright suite. Decide development-mode `Secure` first.
2. **No rate limiting anywhere.** Owner decision; Stage 9 owns all of it. Login is unthrottled
   and argon2id's ~100ms cost is the only brake. When Stage 9 adds it, set `trust proxy`
   **first**: behind the Next.js rewrite every caller shares one `req.ip`, so an IP-keyed
   limit throttles the whole university at once. Do not use `trust proxy: true`, which makes
   `X-Forwarded-For` spoofable.
3. **`req.url` is logged unredacted.** `log-redaction.ts` says so in its own comment, and it
   names Stage 4's invitation tokens as the reason to care. Close it before those land. Error
   objects are now covered by `*.headers.cookie`; the URL is not, because pino serialises it
   as one opaque string.
4. **CI has never run.** The workflow now has a `verify` job and an `e2e` job; neither has
   executed once, because no remote exists. The `e2e` job was read line by line as a runner
   would and one real defect was found and fixed (it never built `@majlis/contracts`, whose
   `dist/` is gitignored). One green run is still the only real evidence.
5. **No password reset, no email verification, anywhere in the spec.** A student who forgets
   their password has no recovery path and an Admin cannot give them one. The sign-in screen
   therefore ships with no "forgot password" link, because it would lead nowhere. Needs a
   product decision before Stage 8.
6. **OpenAPI has no success-response schemas.** Adding the `@ApiResponse` error declarations
   displaced Nest's auto-generated defaults. This is also why Stage 3 uses a hand-written
   client rather than codegen.

---

## Deliberate simplifications, do not "restore" them

- **Refresh tokens do not rotate.** One opaque token per login, revoked on logout and on
  suspension, expiring 30 days after login regardless of activity. Rotation with family-wide
  reuse detection existed and was removed as disproportionate. The schema keeps `family_id`
  (used by logout) and `replaced_by` (now unused; dropping it needs a migration for no gain).
- **No rate limiting.** `@nestjs/throttler` removed entirely; Stage 9 owns it.
- **The account menu is `modal={false}`.** The menu-open axe scan found a real WCAG 4.1.2
  failure: Radix marked the shell `aria-hidden` while the bottom tab bar stayed focusable.
  Radix suppresses Tab regardless of `trapFocus`, so keyboard users are not stranded. What is
  lost is the focus scope and outside-pointer blocking, both smaller than the violation.
- **No `(public)` route group.** Majlis has no landing page and no anonymous browsing, so
  every viewer of `/clubs` and `/events` is signed in and keeps the bottom tabs.

---

## Things that will bite you

Beyond `CLAUDE.md`'s toolchain traps, all verified the hard way.

**From Stage 3:**

- **A Server Component cannot pass a component *reference* to a Client Component.** Passing
  `icon: ComponentType` across the boundary throws an RSC serialization error **at render
  time**, and `build`, `typecheck` and `lint` all pass because those routes never render at
  build time. Pass a `ReactNode` instead. This shipped broken and was caught only by curling
  the page.
- **Middleware runs before rewrites**, so `/api/v1/*` must be excluded from its matcher or an
  anonymous login POST is redirected to `/login` and signing in becomes impossible.
- **Never derive a fetch origin from request headers** (`x-forwarded-host`, `req.url`) when
  the request carries cookies. A spoofed `Host` exfiltrates the refresh token server-side.
  `lib/api-origin.ts` is the only source.
- **`NextResponse.next()` forwards the original cookie header.** A session renewed in
  middleware is invisible to the current render unless you rebuild the forwarded headers.
- **`res.cookies.delete(name)` with no path** uses RFC 6265 default-path, which is the
  request's directory, so a stale cookie survives on any nested route.
- **Vitest 5 transforms with oxc, not esbuild.** For a `.ts` test importing a `.tsx` module
  you need `oxc: { jsx: { runtime: 'automatic' } }`; the `esbuild` key is silently ignored.
- **`next/font` rejects `axes` alongside a fixed `weight`.** Use `weight: 'variable'`.
- **`next-env.d.ts` is now gitignored.** Next rewrites it depending on whether `dev` or
  `build` ran last, which produced a permanently dirty working tree.
- **Do not set `NODE_ENV=production` in the E2E CI job.** `secureCookies()` would then emit
  `Secure` cookies over the runner's plain HTTP and every signed-in test would fail.

**From Stages 1 and 2:**

- **Throwing inside `host.run()` rolls back everything, including the audit row.** The client
  still sees a correct 4xx, so it looks fine. Return a result and throw after the commit.
- **Nest stops at the first guard that denies.** A controller-scoped guard never runs if a
  global one denies first.
- **Prisma raises `P2007`, not `P2023`, for a malformed UUID** with `@prisma/adapter-pg`.
- **Zod 4's `.url()` does not restrict the scheme.** It accepts `javascript:` and
  `data:text/html`. Any user-supplied URL needs an explicit allowlist.
- **`z.email().trim()` validates before trimming.** Use `z.string().trim().email()`.
- **`user.email` is `TEXT` with `CHECK (email = lower(email))`.** Normalise on lookup as well
  as insert: the insert fails loudly, the lookup fails silently as "wrong password".
- **Guards run outside the request's transaction.** An audit row written in a guard needs its
  own `host.run()`.

---

## On process

Stage 3 ran ten tasks with one review each, plus a whole-branch review at the end. That last
review is where the value was, and the reason is structural: **a per-task review compares code
to its task, and never the task set to the spec.** Ten task reviews passed while the stage was
missing four spec requirements, because the plan's file table never listed them.

The other recurring lesson held again. Every review found real defects, and nearly all of them
originated in the *plan* rather than in the implementations: a test asserting the wrong call
count, a matcher that made login impossible, a test that was a tautology TypeScript already
guaranteed, icon commands that never produced the maskable icon they promised.

So: **before trusting a test, name the broken implementation it would catch.** And when a
suite passes on the very first run, treat that as a question rather than an answer. Stage 3's
axe suite was green immediately; it only counted as evidence after deliberately breaking a
label and watching it go red.
