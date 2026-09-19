# Majlis operator handbook

For whoever runs Majlis. It assumes you did not write it.

The API is one NestJS process serving `/api/v1`. The web app is Next.js and
proxies `/api/v1/*` to the API, so the browser only ever talks to the web
origin. State lives in PostgreSQL and in two Supabase storage buckets.

The **web app runs on Vercel**. The **API runs on Render** as a persistent Node
process, configured by `render.yaml` at the repository root.

**Node 22.12 or newer is required.** Not a preference: NestJS 12 is ESM-only and
this app compiles to CommonJS, so it depends on Node's `require(esm)`, which
was unflagged in 22.12. On anything older the process dies on its first import
with `ERR_REQUIRE_ESM`. This is why the API is not on a serverless platform.

## Read this before the first deploy

### The two storage buckets are created by hand

Nothing in this repository creates or verifies either bucket. A fresh
environment looks healthy, serves every screen, and then returns a 500 the
first time anyone downloads a certificate. **This is the most likely
first-deploy failure.**

| Bucket | Visibility | Holds |
| --- | --- | --- |
| `majlis-storage` | **Public** | Club logos, club banners, event posters |
| `majlis-certificates` | **Private** | Certificate PDFs |

Both names are constants in `apps/api/src/storage/image-kinds.ts`, not
environment variables. Create them in the Supabase project with exactly those
names before anyone uses the system.

`majlis-certificates` must be private, and this is not a preference. A
certificate's object path is a pure function of its id, and every holder of
`registration:read` can list those ids. In a public bucket that makes
`/object/public/<path>` readable with no cookie at all, which is exactly what
the ownership check on `GET /certificates/{id}/pdf` exists to prevent. Signing
the URL does not close it: only a private bucket refuses the unsigned path.
The route hands out a signed URL valid for 300 seconds.

To check a live environment: fetch a certificate object at
`/storage/v1/object/public/majlis-certificates/...` with no credentials. It
must not return 200.

### `pg_trgm` is a database requirement

Added in Stage 8 for event search. Migration `20260914175400_perf_indexes`
runs `CREATE EXTENSION IF NOT EXISTS pg_trgm` and then builds a GIN index on
`event.title`. On a database where the extension is unavailable, or where the
migrating role may not create extensions, **the migration fails and the deploy
stops there**. Supabase ships it; a locked-down self-hosted Postgres may not.

`GET /events?q=` is `title ILIKE '%term%'`, which no btree can serve. Without
the index it is a sequential scan.

## Environment variables

`apps/api/src/config/env.schema.ts` is the authority. The API validates the
whole environment at boot and **refuses to start** if anything is wrong, rather
than failing on the first request. It reads `.env` at the repository root.

### API, required

No default. The process will not start without them.

| Variable | What it does |
| --- | --- |
| `DATABASE_URL` | Postgres connection string the application uses. Must be a `postgres://` or `postgresql://` URL. On Supabase use a **pooler** hostname (`aws-N-<region>.pooler.supabase.com`), not `db.<ref>.supabase.co`. For the API on Render, the **session** pooler (`:5432`). Only use the transaction pooler (`:6543`) if you ever run it serverless |
| `SESSION_SECRET` | Signs the session JWT. Minimum 32 characters |
| `SUPABASE_STORAGE_URL` | Supabase project storage base URL. Must be `https://` |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key. Minimum 20 characters. Never expose it to a browser |

### API, defaulted

| Variable | Default | What it does |
| --- | --- | --- |
| `NODE_ENV` | `development` | `development`, `test` or `production`. Production turns on the production-only refusals below, the `__Host-` cookie prefix, and turns off `/api/v1/docs` |
| `PORT` | `3001` | Listen port |
| `LOG_LEVEL` | `info` | `fatal`, `error`, `warn`, `info`, `debug`, `trace`. `.env.example` sets `debug` |
| `ACCESS_TOKEN_TTL` | `15m` | Access token lifetime. Any duration `ms()` accepts, must be greater than zero |
| `REFRESH_TOKEN_TTL` | `30d` | Refresh token lifetime. Refresh tokens do not rotate; this is a hard cap from login, with no sliding expiry |
| `LIFECYCLE_SWEEP_SECRET` | example value | Shared secret for `POST /internal/lifecycle-sweep`. Minimum 16 characters |
| `QR_SIGNING_SECRET` | example value | Signs every QR pass. Minimum 32 characters |
| `NOTIFICATION_SWEEP_SECRET` | example value | Shared secret for `POST /internal/notification-sweep`. Minimum 16 characters |
| `ATTENDANCE_CORRECTION_WINDOW_HOURS` | `48` | Hours after an event ends during which Operations and Lead may correct attendance. Also gates issuance: certificates go out once it closes |
| `PUBLIC_WEB_ORIGIN` | `http://localhost:3000` | Where the QR printed on a certificate points, for `/verify/{code}`. Set it to the real web origin or issued certificates carry a QR nobody can scan |
| `RESEND_FROM` | `Majlis <notifications@majlis.invalid>` | From address on outbound email |
| `RESEND_API_KEY` | unset | Turns email on. See below |

### Refused in production

Four secrets ship with a working default so the repository clones and runs.
With `NODE_ENV=production` the API refuses to boot if any of them still holds
the published example value:

| Variable | Example value it refuses |
| --- | --- |
| `SESSION_SECRET` | `dev-only-session-secret-change-me!!` |
| `LIFECYCLE_SWEEP_SECRET` | `dev-only-lifecycle-sweep-secret` |
| `QR_SIGNING_SECRET` | `dev-only-qr-signing-secret-change-me!!` |
| `NOTIFICATION_SWEEP_SECRET` | `dev-only-notification-sweep-secret` |

`SESSION_SECRET` has no default at all, so it is always required; the refusal
is for a deployment that copied `.env.example` wholesale.

`QR_SIGNING_SECRET` is the expensive one to get wrong. It signs every QR pass,
so a deployment running on the published value lets anyone mint a pass for any
user id they can guess.

### Web

| Variable | What it does |
| --- | --- |
| `API_ORIGIN` | Origin that `/api/v1/*` is rewritten to. **Required in production**, at build time and at run time: the build and the server both throw without it. Falls back to `http://localhost:3001` outside production |

### Tooling only, not read by the running API

| Variable | Read by | What it does |
| --- | --- | --- |
| `DIRECT_URL` | `apps/api/prisma.config.ts` | Connection string for migrations. On Supabase use the **session pooler** (`:5432` on the `pooler.supabase.com` host). **Not** `db.<ref>.supabase.co`: that host is IPv6-only and unreachable from most build machines, which fails as `P1001`. Falls back to `DATABASE_URL` |
| `SHADOW_DATABASE_URL` | `apps/api/prisma.config.ts` | Only read by `prisma migrate diff`. `migrate dev` creates and drops its own when unset |
| `TEST_DATABASE_URL` | integration test harness | Overrides the `majlis_test` database the harness otherwise derives from `DATABASE_URL` |
| `ALLOW_REMOTE_SEED` | `prisma/seed.ts` | Set to `yes` to let the seed run against a non-local database. It refuses otherwise, and refuses `NODE_ENV=production` regardless |

## The two sweep endpoints

Both are `POST`, both live under `/api/v1/internal`, and neither takes a
session. Each is authenticated by its own shared secret in its own header, so
one leaked scheduler credential does not authorise the other. Comparison is
constant-time and constant-length; a wrong or missing secret is a 401.

| Endpoint | Header | Secret | What it does |
| --- | --- | --- | --- |
| `POST /api/v1/internal/lifecycle-sweep` | `x-lifecycle-sweep-secret` | `LIFECYCLE_SWEEP_SECRET` | Advances every event whose status is behind the clock, then issues certificates for every event whose correction window has closed. Returns counts |
| `POST /api/v1/internal/notification-sweep` | `x-notification-sweep-secret` | `NOTIFICATION_SWEEP_SECRET` | Delivers every `PENDING` notification through the configured channel. Returns counts |

**Telling them apart:** the header and the variable always name the same sweep.
`lifecycle` goes with `lifecycle`, `notification` with `notification`. They are
different values by design, so presenting one to the other's endpoint returns
401 and does nothing.

```bash
curl -X POST https://<api>/api/v1/internal/lifecycle-sweep \
  -H "x-lifecycle-sweep-secret: $LIFECYCLE_SWEEP_SECRET"

curl -X POST https://<api>/api/v1/internal/notification-sweep \
  -H "x-notification-sweep-secret: $NOTIFICATION_SWEEP_SECRET"
```

### Nothing calls either one on a schedule today

There is no cron, no queue and no scheduler in this repository. The sweeps are
endpoints and nothing more.

What this costs, and what it does not:

- **Event status is fine without them.** The lifecycle is lazy: every read of
  an event advances it to its due status first, so students and officers always
  see the correct state whether or not a sweep has ever run.
- **Certificates are not.** Automatic issuance happens only inside the
  lifecycle sweep. Until something calls it, an event past its correction
  window issues nothing. An officer can still issue by hand with
  `POST /events/{eventId}/certificates/issue`.
- **Email is not.** Notifications are written to the database by their
  triggers and appear in the in-app inbox immediately, but they stay `PENDING`
  until a notification sweep delivers them. The one exception is the password
  reset, which delivers inline so the raw token never persists.

When you schedule them, call both on a short interval, a few minutes apart is
fine. Both are idempotent: a run with nothing due does no work and writes
nothing.

## Turning on email

Setting `RESEND_API_KEY` is the whole switch. There is no code change.

With no key, the channel factory resolves `SkippingChannel`: every notification
is marked `SKIPPED`, nothing is sent, and the in-app inbox works completely.
That is the shipped state.

Two things belong in the same change as the key.

**Email delivery has never been verified end to end.** There has never been a
key. The abstraction, the triggers, the failure handling and the inbox are all
real and tested. `ResendChannel` is exercised only through template render unit
tests. The first real send is the first real send; watch the `email_status` and
`email_error` columns on `notification` and treat the first day as a trial.

**Rate limit `POST /auth/forgot-password` in the same change.** It is
unauthenticated, it sends mail to an address the caller chooses, and it always
answers 202 regardless of whether the address exists, so nothing slows a caller
down. Unlimited, it can be pointed at any student's inbox and will burn the
Resend quota. It costs nothing while no key is set, which is why it has
survived. There is no rate limiting anywhere in the product to build on, so
this means a proxy rule, a platform-level limit, or new code.

Also set `RESEND_FROM` to a real address on a domain verified with Resend. The
default is `notifications@majlis.invalid` and will not deliver.

## Known limits

Stated as facts. None of these is a bug report.

| Limit | Detail |
| --- | --- |
| **No rate limiting, anywhere** | Dropped from the build by the product owner on 2026-09-13, not an oversight. Login, signup, scan, `/verify/{code}`, `forgot-password` and both sweep endpoints are all unlimited. Argon2id's cost is the only brake on password guessing |
| **There is no CI** | The GitHub Actions workflow was removed on 2026-09-15 by the product owner: deployment is Render and Vercel, and both run their own build. Every suite runs locally, on one Windows machine. Before it was removed the workflow had run once and failed two jobs, `Migrations match schema` and the e2e suite on a clean Linux runner. Neither was triaged, so both failures are still unexplained |
| **Email delivery is unverified** | See above. No key has ever existed, so no message has ever been sent |
| **Both buckets are hand-made** | See the top of this document |
| **The QR scanner needs a secure context** | It uses `BarcodeDetector` and `navigator.mediaDevices.getUserMedia`, and browsers withhold both outside a secure context. Over plain HTTP on a LAN address the camera will not open. `localhost` counts as secure; `http://192.168.x.x` does not. Where the scanner is unavailable it says so once and hands over to manual check-in by email, which works everywhere |
| **No offline support** | Majlis is an installable PWA but scanning and every other action require connectivity |
| **The web app has no deployment config in this repository** | `render.yaml` covers the API. The Vercel project for `apps/web` is configured in the dashboard: root directory `apps/web`, and `API_ORIGIN` pointing at the Render service |
| **Nothing schedules the sweeps** | Certificates issue and queued email sends only when something calls the two `/internal/*-sweep` endpoints. A scheduled caller is the intended backstop and is not built |
| **Orphaned uploads accumulate** | Replacing a club logo or event poster leaves the previous object in the bucket, and no image can be deleted through the API at all |
| **`GET /clubs/{id}/audit` scans up to 500 event ids per page** | `AuditLog` deliberately has no foreign keys, so a club's audit is assembled from the club id plus its event ids. The upgrade path is a `club_id` column written at record time |
| **No CSP on the web app** | Deliberate. Inline styles and a server-generated inline SVG mean a policy tight enough to be worth having breaks rendering, and one loose enough not to buys nothing. `X-Content-Type-Options`, `Referrer-Policy` and `X-Frame-Options: DENY` are set |
| **OpenAPI docs are off in production** | `/api/v1/docs` mounts outside Nest's guard pipeline and cannot be authenticated, so it does not exist when `NODE_ENV=production`. Generate the document from a non-production build if you need it |

## Operational basics

### Migrations

```bash
pnpm --filter @majlis/api prisma:deploy     # apply, production
pnpm --filter @majlis/api prisma:migrate    # create and apply, development only
```

`prisma:deploy` uses `DIRECT_URL` if set, otherwise `DATABASE_URL`. On Supabase
set it to the **session pooler** (`:5432` on `aws-N-<region>.pooler.supabase.com`).
Two traps, both of which have already cost a deployment: migrations cannot run
through the transaction pooler (`:6543`), and the direct host
`db.<ref>.supabase.co` resolves to IPv6 only, so a build machine without IPv6
fails with `P1001: Can't reach database server` while the same string works
from a developer machine that happens to have IPv6.

On Render, migrations run in the build (`render.yaml`), before the new instance
serves traffic, so a schema change ships with the commit that makes it.

`prisma migrate dev` does not run `generate` for you.

**Never edit an applied migration file, including its comments.** Prisma stores
the file's hash. `migrate deploy` ignores a mismatch, but `migrate dev` refuses
to run at all and offers to drop the database.

### Seeding

```bash
pnpm --filter @majlis/api db:seed
```

Development data, idempotent, safe to re-run. It refuses to run when
`NODE_ENV=production`, and against any non-local database unless
`ALLOW_REMOTE_SEED=yes`.

Re-running it refreshes the demo check-in window, so a seeded event is always
scannable now rather than at whatever time it was first seeded.

### Demo logins

Seeded data only, never present in a production database. Password `Passw0rd!`.

| Email | Role |
| --- | --- |
| `admin@uni.ac.ae` | Platform Admin |
| `lead@uni.ac.ae` | Club Lead of Robotics Club |
| `ops@uni.ac.ae` | Operations Officer of Robotics Club |
| `student@uni.ac.ae` | Student |

If these work against a deployment that is supposed to be real, the seed has
been run against it. Treat that as an incident: the password is published here.

### Health and logs

`GET /api/v1/health` is the liveness check and hits the database.

Logs are pino, structured, at `LOG_LEVEL`. Cookies, authorization headers,
`set-cookie`, `RESEND_API_KEY` and token and code query parameters are redacted
at the logger. No raw QR token, password, session token or reset token is
stored or logged anywhere.

### When something looks broken

| Symptom | Look here first |
| --- | --- |
| 500 on the first certificate download | `majlis-certificates` bucket is missing or public |
| Migration fails on a fresh database | `pg_trgm` unavailable, or the migrating role may not create extensions |
| API will not start | The environment failed validation. The error names the variable and the rule, never the value |
| Login works but every API call 500s in the browser | `API_ORIGIN` points somewhere the web server cannot reach |
| Certificates never appear after an event | Nothing is calling the lifecycle sweep |
| Notifications appear in the inbox but no email arrives | `RESEND_API_KEY` unset, so every row is `SKIPPED`, or nothing is calling the notification sweep |
| Certificate QR codes point at the wrong host | `PUBLIC_WEB_ORIGIN`. Already-issued certificates keep the old URL |
| Scanner will not open the camera | Not a secure context. Use HTTPS or `localhost` |

### When a test looks broken

Four failures that look like product defects and are not. Each one cost a session.

**A Playwright failure about times, after a pull.** The Stage 8 timezone fix pins
`options=-c timezone=UTC` on the connection. Every row written to `majlis_dev` before
that commit is four hours off. Reseed with `pnpm --filter @majlis/api db:seed` before
believing the assertion.

**"Element not found" on a second or third full Playwright run.** `next dev` reaches
1.7 GB after two runs and Node's 4 GB cap then produces failures that read as missing
markup. Restart it between full runs. Stopping the pnpm wrapper does not kill the
child; find the process holding port 3000.

**"Internal Server Error" in an e2e run, with nothing wrong in the API log.** Check the
*web* server's proxy log. A burst of `Restarting 'src/main.ts'` in the API plus
`ECONNREFUSED` in the proxy has produced phantom failures in Stages 6, 7 and 8. The API
log alone shows nothing.

**Dozens of integration failures at once, with `40P01 deadlock detected` in
`beforeEach`.** Two integration runs against the one test database deadlock each other:
`truncateAll` takes ACCESS EXCLUSIVE while the other run holds row locks. Run one at a
time. A full-suite result collected alongside a single re-run file once showed 63
spurious failures.

A fifth, for whoever adds a test: **a test that logs out, resets a password, or suspends
a user must create its own account.** Logout stamps `sessions_invalidated_at`
account-wide, so a destructive test sharing a seeded fixture invalidates it under every
test running in parallel.

## Where the rest is written down

- [`docs/specs/2026-09-10-majlis-design.md`](specs/2026-09-10-majlis-design.md).
  Binding. Section 3 is the decisions ledger, section 13 the build stages with
  a completion note and every deviation per stage.
- [`docs/superpowers/plans/`](superpowers/plans/), one plan per stage.
- [`README.md`](../README.md) for running it locally.
