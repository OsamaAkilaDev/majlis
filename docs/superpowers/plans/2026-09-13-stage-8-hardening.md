# Stage 8 — Hardening

Branch `stage-8-hardening`. The last stage. **Security, optimisation and performance, the
README and the handbook. Nothing else.**

**No rate limiting and no deployment.** Both dropped by the product owner on 2026-09-13; see
§13. Nothing here writes `vercel.json`, a CI workflow, or deployment configuration, and
nobody should add rate limiting back without asking.

## The shape is inverted, on purpose

Every other stage was build, then review. A hardening stage has nothing to build until
something is found, so the audit **is** the work:

1. Two read-only audits in parallel: security over the whole codebase, performance over the
   whole codebase. Neither edits anything.
2. One dispatch applies everything both find, plus the decided items below.
3. One dispatch writes the README and the handbook, last, so they describe what shipped
   rather than what was planned.

## Decided going in, not open for re-litigation

**`__Host-` cookie prefix in production only.** The prefix requires `Secure`, which requires
HTTPS, and both the dev loop and Playwright run over HTTP. `secureCookies(nodeEnv)` already
exists in `apps/api/src/auth/cookies.ts` and is the seam.

**`pg_trgm` gets added.** Verified available on the local Postgres 18.6 as version 1.6 and
not yet installed. `GET /events?q=` is a sequential scan today: `title ILIKE '%…%'` cannot use
a btree. A migration creates the extension and a GIN index. **This changes the deployment's
database requirements**, so it goes in the handbook.

**The em dash sweep happens.** 185 of them across 60 files, in code that predates the rule.
`CLAUDE.md` bans them. It is mechanical, it is one commit, and leaving it makes the rule look
optional.

**The club audit keeps its 500-event cap** rather than gaining a `club_id` column on
`AuditLog`. The column is the right long-term answer and it is a migration plus a backfill of
an append-only table, which is not a last-stage change. The `ponytail:` comment already names
the upgrade path.

**Accessibility and performance are measured, not asserted.** A Lighthouse number or an axe
pass that nobody ran is worse than none, because it will be quoted later.

---

## Task 1 — Security audit (read-only, parallel with Task 2)

Whole codebase, not a diff. Seven stages have never had a single security pass over the
product as a whole; every previous review saw one branch.

Priorities: authentication and session handling end to end; the permission matrix against
spec §6.1 in full, including every route that has no `@RequirePermission` and should;
multi-tenancy, meaning any path where a club's data can be reached through another club's
scope; the three secrets and their redaction; the two public routes and the two
shared-secret sweep routes; and anything that writes without an audit row.

Output is a ranked list with file, line, a concrete exploit path, and a fix. **No edits.**

## Task 2 — Performance audit (read-only, parallel with Task 1)

Priorities: N+1 queries, which nothing has ever looked for in this codebase; missing indexes
behind the filters and sorts the API actually offers; `GET /events?q=`'s sequential scan;
payload sizes on list endpoints; the web bundle, particularly whether `@react-pdf/renderer`
or `qrcode` leak into a client chunk; Core Web Vitals on the three heaviest screens; and the
scan path, which is the one surface with a real latency requirement.

Measure rather than infer: `EXPLAIN ANALYZE` for queries, the actual build output for
bundles. Output is a ranked list with the measurement that justifies each item. **No edits.**

## Task 3 — Apply the findings

Everything both audits confirm, plus these, which are already decided:

- The `__Host-` cookie prefix in production.
- The `pg_trgm` migration and GIN index, with a test that the search still returns the right
  rows (an index that changes results is not an optimisation).
- **`db:seed`'s guard is `status: { not: 'CANCELLED' }`**, so a registration left `NO_SHOW` by
  an earlier suite run is never restored, and the documented "re-run `db:seed` to refresh the
  scan window" fixes the window and not the registration. The attendance walk then fails in a
  way that looks like a product bug. It has already cost a session time. Widen the guard.
- The em dash sweep.
- The skip link's focus ring, which is `--color-primary` against the deep-green auth ground
  and too low-contrast to see. Needs a focus token that works on light surfaces and dark
  grounds.

## Task 4 — README and handbook

**The README is seven stages stale** and still says "Stage 1 (this repo, currently) builds
the API only, `apps/web` lands in a later stage". Rewrite it: what Majlis is, the stack, how
to run it, how to test it, and the repository layout. Short.

**The handbook is new**, at `docs/handbook.md`, and is written for whoever operates this
rather than whoever built it. It must carry, at minimum:

- The environment variables, all of them, what each does, and which are refused in production.
- **Both Supabase buckets and their visibility.** `majlis-storage` public, `majlis-certificates`
  private. Nothing in the repository creates or verifies them, so a fresh environment silently
  500s on the first certificate download. This is the single most likely first-deploy failure.
- The two sweep endpoints, what they do, what they are authenticated by, and that nothing
  calls them on a schedule today.
- **Turning on email**: setting `RESEND_API_KEY` is what makes `POST /auth/forgot-password`
  able to send mail to a caller-chosen address, and it is unauthenticated with no rate limit,
  so it should be limited in the same change.
- That `pg_trgm` is now a database requirement.
- The known limits, stated plainly: no rate limiting, CI has never run, email delivery has
  never been verified, and the buckets are hand-made.

---

## Verification before the review

```bash
pnpm typecheck && pnpm lint && pnpm test
pnpm --filter @majlis/api test:integration
API_ORIGIN=http://localhost:3001 pnpm build
pnpm --filter @majlis/web test:e2e     # restart next dev first
```

**Check the API log for `Restarting 'src/main.ts'` before believing any e2e failure.** This
has produced phantom failures twice, in Stage 6 and Stage 7, and both times the evidence was
in the web server's proxy log as `ECONNREFUSED`, not in the API log.

Then tick Stage 8 in §13, write the final completion note, and rewrite `handoff.md` one last
time for whoever picks this up next.
