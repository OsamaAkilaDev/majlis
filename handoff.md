# Handoff

**Written 2026-09-13, after Stage 6.** `CLAUDE.md` holds the durable rules. Delete this
once its gaps are actioned.

---

## State

Stages 1 to 6 complete, all merged to `master`. Nothing pushed; no remote exists.

| | |
|---|---|
| Tests | 371 API integration, 165 API unit, 60 contracts, 124 web unit, 160 Playwright/axe |
| Migrations | 9. Stage 6 added none |
| API | auth, users, departments, clubs, team, invitations, membership, events, registrations, qr-pass, attendance, certificates |
| Frontend | four shells now: student, club, admin, and a minimal `(public)` one for `/verify/[code]` |

Seeded logins: `admin@` / `lead@` / `ops@` / `student@uni.ac.ae`, password `Passw0rd!`.
The seed now builds a scannable world: `drone-build-night` has an open check-in window with
`student@` confirmed, and `line-follower-sprint` ended 72 hours ago with an attendance record
and certificates issued. Re-running `db:seed` refreshes the scan window.

**Next: Stage 7, notifications and reporting.**

---

## Decisions already taken for Stages 7 and 8

Agreed with the user 2026-09-13, before an unattended run. Do not re-litigate.

- **Resend ships unwired.** Build the full `NotificationChannel` abstraction, all nine
  triggers and the React Email templates, tested against a fake transport. With no API key
  the channel records `email_status = 'SKIPPED'` and the in-app inbox works completely.
  Pasting a key later turns email on with no code change.
- **Stage 8 is security, optimisation and performance, the README and the handbook. That is
  all.** Revised 2026-09-13, replacing the earlier "deployment-ready" scope. Deployment,
  `vercel.json`, the production env inventory and CI are deferred and will be done with the
  product owner directly. Nothing in Stage 8 writes deployment configuration.
- **There is no rate limiting anywhere, and none is coming.** Dropped entirely 2026-09-13,
  replacing the earlier decision that named per-route limits. Do not add it back without
  asking. The one consequence to carry: `POST /auth/forgot-password` is unauthenticated,
  sends mail to a caller-chosen address, and always answers 202, so **anyone turning on
  `RESEND_API_KEY` should limit that route in the same change.**
- **Password reset yes, email verification no.** A single-use hashed token, short expiry,
  and revocation of every refresh token on a successful reset. Email verification is out
  permanently: one university, the email is the identity key, and an unverified signup can
  already do nothing until an officer or admin acts.
- **`__Host-` cookie prefix in production only.** It requires `Secure`, which requires
  HTTPS, and both the dev loop and Playwright run over HTTP.
- **`pg_trgm` gets added**, fixing the `GET /events?q=` sequential scan.
- **When something is genuinely ambiguous, decide, record it in §13, and keep going.**

---

## Read order

1. `docs/specs/2026-09-10-majlis-design.md`. Binding. §13 has the stages, the completion
   notes, and **"How a stage is built"**, which is the process and the most important thing
   to read before starting.
2. The Stage 6 completion note in §13.
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

**`.env` is nine values now.** Stage 6 added `QR_SIGNING_SECRET` (production refuses the
example value, like `SESSION_SECRET` and `LIFECYCLE_SWEEP_SECRET`),
`ATTENDANCE_CORRECTION_WINDOW_HOURS` and `PUBLIC_WEB_ORIGIN`.

**Supabase now needs two buckets.** `majlis-storage`, public, for logos, banners and
posters. `majlis-certificates`, **private**, for certificate PDFs. The names are constants
in `apps/api/src/storage/image-kinds.ts`, not variables.

---

## Things that will bite you

**New in Stage 6:**

- **An e2e failure may be the API restarting, not a bug.** A Playwright run against the
  `node --watch` API produced twelve failures that looked like application defects,
  including "Internal Server Error" on the sign-in form. The API had restarted six times
  mid-suite; the Next rewrite got `ECONNREFUSED` and the browser saw Next's own 500. The API
  log had **zero** 500s on `/auth/login`. The evidence was in the *web* server's proxy log.
  Check for `Restarting 'src/main.ts'` in the API log before believing an e2e failure.
- **A design doc is not evidence about a live service.** A review finding that every
  certificate download would 500, reasoned correctly from the Stage 4 design doc's
  "Allowed MIME types: `image/webp`", was wrong. The live bucket accepts `application/pdf`.
  Probe the service.
- **Signing a URL in a public bucket closes nothing.** The object stays readable at
  `/object/public/<path>` with no cookie. Only a private bucket refuses the unsigned path.
- **A test fake that drops an argument makes that argument untestable.** The certificates
  integration fake ignored `putObject`'s bucket parameter, so a mutation sending credential
  documents back to the public bucket stayed green.
- **A custom Tailwind token whose name collides with a utility prefix gets merged away
  silently.** `text-body` went through `cn()`, and tailwind-merge cannot know `--text-body`
  is a font size, so it filed it under text colour and dropped the variant's
  `text-primary-fg`. That shipped as 1.87:1 contrast on a button. Use `text-base`.
- **A promise rejected inside a `load()` effect reaches no React error boundary.** Adding
  `error.tsx` alone fixes nothing; `lib/use-async-error.ts` rethrows during render.
- **A `P2002` cannot be caught inside its own transaction.** Postgres aborts the whole
  transaction on a constraint violation, so the catch only reaches a connection refusing
  every further statement. Idempotency is `createMany({ skipDuplicates: true })`, which is
  `ON CONFLICT DO NOTHING` at the database. Retries go outside the transaction.
- **Resolving a user before the authorization or state gate makes an oracle.** Every refusal
  reachable without knowing whether the subject exists must be returned before the lookup,
  and the ones after it must collapse to a single answer.

**From Stage 5, still true:**

- **Never edit an applied migration file, including its comments.** Prisma stores the file's
  hash. `migrate deploy` ignores a mismatch; `migrate dev` refuses to run at all and offers
  to drop your database.
- **A constant imported from a `'use client'` module reaches a Server Component as a client
  reference, not its value.** `lib/page-size.ts` exists because of this.
- **A default argument that reads the runtime environment is a hydration bomb.**
  `lib/use-viewer-zone.ts` supplies it explicitly instead.
- **Express leaves `req.body` undefined when a request carries no body**, so a plain object
  schema turns every bodyless `POST` and `DELETE` into a 400. Override bodies are
  `.optional().default({})`.
- **A long-lived `next dev` balloons past Node's ~4GB heap** and starts failing to compile
  routes, surfacing in Playwright as `element(s) not found`. One reached 4,865 MB after 3.5
  hours and another 3,136 MB in two. Restart it between e2e runs. **`TaskStop` on the pnpm
  wrapper does not kill the `next dev` child**; kill the process holding port 3000.
- **Do not return an in-flight request promise from a Prisma `$transaction` callback.**
  Prisma awaits it before committing, which deadlocks to the 5s timeout. That is the shape
  the deterministic concurrency tests need.

**From Stage 4, still true:**

- **`e.meta?.target` is always empty.** Under `@prisma/adapter-pg` a `P2002` carries the
  constraint at `meta.driverAdapterError.cause.constraint.index`. Use `violatedConstraintName`.
- **Assert the message, not just the status.**
- **A Radix `SelectTrigger` is a `<button>`**, and `<label htmlFor>` cannot bind to one.
- **`PermissionsGuard` reads the scope id from the literal path you pass it.** A club-scoped
  permission cannot authorize a bare unscoped route, which is why `user:search` is nested
  under `/clubs/:clubId/`.
- **Throwing inside `host.run()` rolls back everything**, including a write you meant to keep.
- **`text-ink-muted` is not a token**; only `text-ink-2` is.

---

## Gaps, in the order I would fix them

1. **No password reset.** Decided for Stage 7, above. Blocking for a real deployment.
2. **`__Host-` cookie prefix**, Stage 8. Decision taken, above.
3. **CI has never run, and Stage 8 no longer covers it.** No remote exists. One green run is
   still the only real evidence, and after seven stages of green local suites on a single
   Windows machine it is the largest untested assumption in the project. Path casing, line
   endings and the Playwright browser install each break exactly once, on the first run.
   Goes with the deployment session.
4. **Both storage buckets are created by hand**, `majlis-storage` public and
   `majlis-certificates` private. Nothing in the repository creates or verifies them, so a
   fresh environment silently 500s on the first certificate download.
5. **`GET /events?q=` is a sequential scan.** `pg_trgm`, decided for Stage 8.
6. **Orphaned uploads accumulate**, and no image can be deleted at all.
7. **OpenAPI has no success-response schemas.**
8. **`/me/certificates` is ordered oldest-first**, so a student's newest document is last.

---

## Deliberate simplifications, do not "restore" them

- **No typed QR fallback credential.** A camera failure falls through to manual check-in
  keyed by email. One credential format, one verification path.
- **Six scan outcomes are a 200 with a `result` discriminant.** Only "not authorised" is a
  403. They are things an operator reads, not faults in their request.
- **Certificates are never issued at `COMPLETED`**, only once the correction window closes,
  or §7.5's 48 hours to correct attendance would be zero.
- **An event with `certificateEnabled: false` stays `COMPLETED` forever.** `CERTIFIED` means
  certificates were issued.
- **Waitlisted registrations are not swept to `NO_SHOW`** at completion. They never held a
  seat, and `expected` deliberately excludes them.
- **`BarcodeDetector` only, no zxing.** Where it is absent the scanner says so once and
  hands over the email form.
- **Refresh tokens do not rotate.** One opaque token per login, revoked on logout and
  suspension.
- **No Supabase SDK.** REST calls via `fetch`.
- **`eligibilityRules` stays null.** `User` carries neither department nor year.
- **A reopened registration window is refused, not honoured.**
- **Both halves of the sweep's skip logic are kept**, though either alone leaves the test
  green.

---

## On process

Stage 6 ran as §13 prescribes: two dispatches and one combined review. The review found ten
issues, one exploitable oracle and four correctness defects that would each have reached
production.

Three rules earned their keep again, and they are worth more than any amount of extra
testing:

- **Delete the code a test guards and confirm it goes red.** Two green tests turned out to
  assert nothing, one of them a security control.
- **Assert the response detail message, not only the status code.**
- **Verify against the live service, not against a document.** One review finding was a
  false positive drawn from a design doc that no longer matched reality, and one real
  vulnerability was only confirmed by actually fetching the URL anonymously.
