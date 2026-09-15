# Handoff

**All eight stages are done.** Branch `stage-8-hardening`, merged to `master`. There is no
stage 9; the spec's §13 table is fully ticked and every stage has a completion note.

Read `docs/specs/2026-09-10-majlis-design.md` first, then `docs/handbook.md` for how to run
and operate it. `README.md` is the clean-clone path. This file only carries what is not in
those.

## What is actually left

Three things, and all three were deferred to a working session with the product owner
rather than dropped:

1. **Deployment.** Nothing in this repository writes `vercel.json` or any deployment
   configuration. Decided 2026-09-13, recorded in spec §14.
2. **CI.** There is no workflow file and **CI has never run**. Eight stages of green suites
   are eight stages of green suites on one Windows machine. This is the largest untested
   assumption in the project: not any single feature, but the claim that the suites pass
   anywhere else.
3. **The two Supabase buckets.** `majlis-storage` (public, branding) and
   `majlis-certificates` (private, credentials, served by 300-second signed URLs). Both are
   created by hand. Nothing in the repository creates or verifies them, so a fresh
   environment silently 500s on its first certificate download. This is the single most
   likely first-deploy failure and it is in the handbook for that reason.

**Rate limiting is dropped, not pending.** Decided by the product owner on 2026-09-13; see
spec §14. Do not add it back without asking. The one place it matters is recorded below.

## Things that will bite you

**`.env` is sixteen keys in the API schema**, not nine. An earlier version of this file said
nine and was wrong. `apps/api/src/config/env.schema.ts` is authoritative and the handbook
lists every one with what it does and which are refused in production. Four more live
outside the schema for tooling: `DIRECT_URL`, `SHADOW_DATABASE_URL`, `TEST_DATABASE_URL`,
`ALLOW_REMOTE_SEED`. The web app takes one, `API_ORIGIN`.

**Setting `RESEND_API_KEY` is a commitment, not a toggle.** Resend is built and deliberately
left unwired. The moment a key is set, `POST /auth/forgot-password` can send mail to a
caller-chosen address, and it is unauthenticated with no rate limit. Limit it in the same
change that turns email on. Email delivery has never been verified against a real key.

**`pg_trgm` is a database requirement** from the Stage 8 migration on, not an optimisation
you can skip. A fresh database without the extension will fail to migrate.

**Reseed before believing an e2e failure about timestamps.** The Stage 8 timezone fix pins
`options=-c timezone=UTC` on the connection. Every row written to `majlis_dev` before that
commit is four hours off. `pnpm --filter @majlis/api db:seed` corrects it. Production does
not exist yet, so there is nothing to migrate; had it existed, that fix would have needed a
data migration alongside it.

**Restart `next dev` between full Playwright runs.** It reaches 1.7 GB after two runs and
Node's 4 GB cap produces "element not found" failures that look like product defects.
`TaskStop` on the pnpm wrapper does not kill the child; find the PID holding port 3000.

**Check the web server's proxy log, not the API log, before believing any e2e failure.** A
burst of `Restarting 'src/main.ts'` in the API plus `ECONNREFUSED` in the web proxy log has
produced phantom "Internal Server Error" failures three times now, in Stages 6, 7 and 8. The
API log alone shows nothing wrong.

**A shared fixture account plus one destructive test is a suite that fails at random.** The
seed has four accounts and twenty-eight e2e tests sign in as `student@uni.ac.ae`. Logout
stamps `sessions_invalidated_at` account-wide, so the one sign-out test was invalidating the
account under every parallel test using it. It signs up its own account now. Any new test
that logs out, resets a password, or suspends a user must own its account.

**Signing out signs out every device.** That is deliberate: the access token is a stateless
15-minute JWT, and the account-wide stamp is the only thing that ends it. The web middleware
only renews when the session cookie is *absent*, so another device lands on `/login` rather
than renewing silently.

## The two things worth keeping from how this was built

**"Name the broken implementation this test would catch."** Applied before trusting a test,
it found something real in three separate stages: index tests that passed with the index
dropped, concurrency tests using `Promise.all` that passed with the unique constraint
dropped, and a test whose comment claimed it proved the product produced a row while the
test inserted the row by hand.

**Probe the live system; do not reason from a document.** Three of this project's worst
defects were invisible to the code and to every test, and all three were found by a direct
probe: certificates were world-readable (verified by fetching the public object URL with no
credentials), every timestamp was four hours off (verified by writing a known instant and
reading `extract(epoch)` back), and a security review's most confident finding was a false
positive reasoned from a stale design document and disproved by one upload. The running
service is the authority.

## State

Suites as of 2026-09-15: 439 API integration across 34 files, 201 API unit, 72 contracts,
135 web unit, 228 Playwright across two projects, typecheck 4/4, lint 3/3.
