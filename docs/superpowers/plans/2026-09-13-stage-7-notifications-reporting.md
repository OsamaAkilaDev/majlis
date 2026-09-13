# Stage 7 — Notifications & reporting

Branch `stage-7-notifications-reporting`. Five tasks, two dispatches (1-4 API, 5 web),
one combined code and security review at the end.

**One migration**, for `PasswordResetToken`. Everything notifications need already exists:
`notification` with `@@unique([userId, dedupeKey])` and `@@index([userId, readAt])`, and
`audit_log` with indexes on `(entityType, entityId)`, `actorUserId` and `createdAt`, all
from Stage 1.

## Decisions taken here

**Notification rows are written in the same transaction as the action, and email is never
sent in one.** `NotificationService.record()` mirrors `AuditService.record()` exactly:
`host.tx`, so it enlists in whatever transaction the caller opened. It writes
`emailStatus: 'PENDING'` and nothing else. Delivery is a separate, post-commit step,
because §7.7 requires that a failed email never rolls back the action that caused it, and
anything sent inside the transaction can do exactly that.

**Delivery is a sweep, not a fire-and-forget.** `POST /internal/notification-sweep`, behind
its own shared-secret header, picks up `PENDING` rows and delivers them. The alternative,
kicking off delivery after each `host.run` returns, scatters the same three lines across
nine call sites and loses every notification whose process dies between commit and send.
The sweep is the pattern this codebase already uses for the event lifecycle and for
certificate issuance, and it is recoverable by construction. The cost is latency: a
notification waits for the next sweep rather than going out immediately. Recorded, accepted.

**`dedupeKey` is composed from the trigger and its subject**, e.g.
`registration.confirmed:<registrationId>`, `event.cancelled:<eventId>`. A `P2002` on
`(userId, dedupeKey)` is **absorbed, not raised**: a retried action must not double-notify,
and that is the whole purpose of the index. Same reasoning as certificate issuance, and the
same mechanism, `createMany({ skipDuplicates: true })`, since a bare `P2002` caught inside
the transaction only reaches a connection refusing every further statement.

**A "material event change" is a change to `startsAt`, `endsAt`, `venue`, `onlineUrl` or
`timezone`.** §7.7 names the trigger without defining it. These five are the fields that
change whether or where a registered student can physically turn up. A retitled event does
not notify.

**Resend ships unwired**, per the user's decision 2026-09-13. `RESEND_API_KEY` is optional;
absent, the channel resolves to one that marks every notification `SKIPPED` and the in-app
inbox works completely. Present, `ResendChannel` sends and records `SENT` or `FAILED` with
the error. No code changes when a key is added. **Email is therefore never verified to have
been delivered in this stage, and the completion note must say so plainly.**

**Password reset exists; email verification never will.** Decided 2026-09-13. One
university, the email is the identity key, and an unverified signup can already do nothing
until an officer or admin acts. Recorded in §14 so a later session does not reopen it.

**`POST /auth/forgot-password` always answers 202**, whether or not the address resolves.
An endpoint that answers differently is an account-existence oracle, which is exactly the
defect Stage 6's review found on manual check-in. The timing is not equalised, which is a
known and accepted limit: the protection here is that the answer carries nothing.

**CSV exports are capped, not streamed.** §8 says "no unbounded list, anywhere", and an
export is inherently a bulk read. Each export caps at 10,000 rows and sets
`Content-Disposition`. A cap reached is reported in a trailer row rather than silently
truncating.

**Club-scoped audit covers the club row and its events, not every descendant.** `AuditLog`
has no foreign keys by design (§3), so there is no join to walk. `GET /clubs/{id}/audit`
filters `entityId` against the club id plus that club's event ids. Registrations and
attendance rows are not included, because resolving them means a second unbounded id list.
Recorded as a limit, visible in the screen.

**New dependencies:** `resend@6.27.0` (**not** 6.28.0, published 28 hours ago and inside
pnpm 11's refusal window), `@react-email/components@1.0.12`, `@react-email/render@2.1.0`.
All verified on npm. The API already has `react` and JSX enabled, from Stage 6's certificate
PDF.

---

## Task 1 — Notification records, triggers, inbox

**Files**

- Create `packages/contracts/src/notifications/index.ts` + `index.test.ts`
- Create `apps/api/src/notifications/notification.service.ts`,
  `notifications.controller.ts`, `notification-types.ts`, `notifications.module.ts`
- Modify the nine triggering call sites: `clubs/team/team.service.ts`,
  `clubs/membership/membership.service.ts`, `events/events.service.ts`,
  `events/registrations.service.ts`, `certificates/certificates.service.ts`

**Routes**

- `GET /me/notifications` — cursor page, own rows only, `?unread=true` filter
- `POST /me/notifications/:id/read` — own rows only, idempotent

**The nine triggers** (§7.7), each written in the same transaction as its action:

| Trigger | `type` | dedupe subject |
|---|---|---|
| team invitation | `team.invited` | appointment id |
| membership decision | `membership.decided` | membership id |
| event published | `event.published` | event id |
| registration confirmed | `registration.confirmed` | registration id |
| registration waitlisted | `registration.waitlisted` | registration id |
| waitlist promotion | `registration.promoted` | registration id |
| material event change | `event.changed` | event id plus the change's timestamp |
| event cancellation | `event.cancelled` | event id |
| certificate issued | `certificate.issued` | certificate id |
| certificate revoked | `certificate.revoked` | certificate id |

`payload` is JSONB and carries only ids and display strings the inbox needs. **No email
address, no token, nothing a log would have to redact.**

**What gets tested**

One trigger proven to write in the same transaction as its action, by making the action
throw and asserting no notification row survives. Dedupe proven by running a triggering
action twice and asserting one row. Reading another user's notification refused. The
material-change field set, including that a retitled event notifies nobody.

---

## Task 2 — Channel, Resend, templates, delivery sweep

**Files**

- Create `apps/api/src/notifications/notification-channel.ts` (the interface plus the
  skipping implementation), `resend.channel.ts`, `notification-sweep.controller.ts`,
  `emails/` (one React Email template per type, plus a shared layout)
- Modify `apps/api/src/config/env.schema.ts` (+ spec), `config/log-redaction.ts` (+ spec),
  `config/sweep-header.ts`, `.env.example`

**Routes**

- `POST /internal/notification-sweep` — shared secret in
  `x-notification-sweep-secret`, reusing `assertSweepSecret`

**Redaction, in the same commit that introduces the key.** `RESEND_API_KEY` and the new
sweep header both go into `LOG_REDACT_PATHS` with a test, exactly as
`LIFECYCLE_SWEEP_SECRET` did. Stage 5 shipped a sweep secret without that and it landed in
every request log.

**Invariants**

- A channel failure sets `emailStatus: 'FAILED'` and `emailError`, and never throws out of
  the sweep. One bad address must not stop the rest of the batch.
- Delivery is attempted once per row. `PENDING` is the only state the sweep picks up, so a
  `FAILED` row is not retried forever.
- With no `RESEND_API_KEY`, every row resolves `SKIPPED` and nothing is sent.

**What gets tested**

The skipping channel marks `SKIPPED` and calls nothing. A failing channel marks `FAILED`
with the error and leaves the other rows in the batch delivered. The redaction tests.
**Not tested: that Resend actually delivers mail.** There is no key. Say so in the note.

---

## Task 3 — Password reset

**Files**

- Create `apps/api/prisma/migrations/<ts>_password_reset/migration.sql` (`--create-only`,
  then append the hand-written index)
- Modify `apps/api/prisma/schema.prisma`, `apps/api/src/auth/auth.service.ts`,
  `auth.controller.ts`, `packages/contracts/src/auth/index.ts`

**Model**

`PasswordResetToken` — `id`, `userId`, `tokenHash` (sha256, never the raw token),
`expiresAt`, `usedAt?`, `createdAt`. Index on `userId`. **30 minute expiry.**

**Routes**

- `POST /auth/forgot-password` — `{ email }`, always 202, writes a notification of type
  `auth.password_reset` whose payload carries the reset link
- `POST /auth/reset-password` — `{ token, password }`, single use

**Invariants**

- The raw token is never stored and never logged. Only its sha256 lives in the row, exactly
  as `RefreshToken` already does.
- A successful reset marks the token used **and revokes every refresh token for that user**,
  in the same transaction. A password reset that leaves old sessions alive is not a reset.
- An expired, used, or unknown token all answer identically.

**What gets tested**

A reset revokes a live session, proven by using the session cookie afterwards and getting
401. A token works once. An expired token is refused, **asserting the detail message**.
`forgot-password` answers 202 identically for a real and an unknown address.

---

## Task 4 — Reporting, exports, audit viewer

**Files**

- Create `packages/contracts/src/reporting/index.ts` + `index.test.ts`
- Create `apps/api/src/reporting/reporting.service.ts`, `reporting.controller.ts`,
  `exports.controller.ts`, `csv.ts` + `csv.spec.ts`, `reporting.module.ts`
- Create `apps/api/src/audit/audit.controller.ts`, `audit-read.service.ts`
- Modify `apps/api/src/auth/permissions.ts`

**Permissions added**

| Key | Platform | Club |
|---|---|---|
| `report:read` | `ADMIN` | `LEAD`, `VICE_LEAD` |
| `audit:read` | `ADMIN` | `LEAD` |

§6.1's "Read audit log" row is Admin, and Lead scoped to their own club.

**Routes**

- `GET /reports/overview` — `report:read`, platform totals: clubs by status, events by
  status, users, active memberships, certificates issued
- `GET /clubs/:clubId/reports` — `report:read` club-scoped: events, registrations,
  attendance rate, certificates issued
- `GET /audit` — `audit:read`, Admin, cursor page, `?entityType=` `?actorUserId=` filters
- `GET /clubs/:clubId/audit` — `audit:read` club-scoped
- `GET /exports/events.csv`, `/exports/registrations.csv?eventId=`,
  `/exports/attendance.csv?eventId=`, `/exports/certificates.csv?eventId=`

**`csv.ts` is its own unit-tested module.** A field containing a comma, a quote, a newline
or a leading `=` must not break the file or execute in a spreadsheet. The formula-injection
prefix is the one that gets forgotten.

**Invariants**

- Every export is capped at 10,000 rows and says so when it hits the cap.
- An export respects the same permission as the read it exports. `registrations.csv`
  carries personal data, so it is `registration:read`, not `report:read`.
- The audit log is read-only here. There is no route that writes or deletes one.

**What gets tested**

One allowed and one refused role per new permission. CSV escaping, including the formula
prefix. A club Lead reading another club's audit is refused. The export cap.

---

## Task 5 — Web

**Files**

- Create `apps/web/src/app/(student)/me/notifications/` (inbox), and a tab-bar unread badge
- Create `apps/web/src/app/(auth)/forgot-password/`, `(auth)/reset-password/`
- Fill `apps/web/src/app/(admin)/admin/metrics/page.tsx`, `admin/exports/page.tsx`,
  `admin/audit/page.tsx`
- Create `apps/web/src/app/(club)/manage/[clubId]/reports/`

**The chart palette is already derived and validated. Use these values verbatim; do not
invent a palette and do not re-derive one.**

| Mode | Categorical order, never cycled |
|---|---|
| Light, on `#FFFFFF` | `#0D9488` `#4F46E5` `#EA580C` `#DB2777` `#65A30D` |
| Dark, on `#1D1815` | `#12A89E` `#6D6BF5` `#E2600F` `#E8478F` `#6BA80E` |

Both pass all six checks of `dataviz`'s validator: lightness band, chroma floor, adjacent
CVD separation, normal-vision floor, and contrast against their own surface. Dark is a
separately chosen set, not a flip of light.

**The product's own UI tokens were tried first and fail badly as a chart palette**, which is
why this is pinned rather than left to taste. `warnFg #7A4B06` against `badFg #98291F` is
ΔE 1.0 under deuteranopia, effectively one colour: a chart using them is unreadable for
roughly one man in twelve. Three of the five also read as grey at chart scale. UI text
colours and series colours are different jobs.

Rules that come with it: a legend whenever there are two or more series, direct labels on
four or fewer, **never a dual axis**, sequential ramps are one hue light to dark, and status
colours stay reserved for state and never become "series 4". Text wears the ink tokens, not
the series colour.

**The inbox** is a list, not a feed: newest first, unread visually distinct without relying
on colour, and marking one read is optimistic with a rollback on failure. No explanatory
copy anywhere.

**What gets tested**

A Playwright walk: a student registers, the inbox shows the confirmation; an admin opens
metrics, exports a CSV, and reads the audit log. An axe pass on every new screen. The
password reset flow end to end, driven by reading the token out of the notification row,
since no email is sent.

---

## Verification before the review

```bash
pnpm typecheck && pnpm lint && pnpm test
pnpm --filter @majlis/api test:integration
API_ORIGIN=http://localhost:3001 pnpm build
pnpm --filter @majlis/web test:e2e     # restart next dev first
```

**Check the API log for `Restarting 'src/main.ts'` before believing any e2e failure.**
Stage 6 lost an hour to twelve failures that were the API restarting mid-suite, not bugs.

Then the combined code and security review over the whole branch. Fix what it finds. Tick
Stage 7 in spec §13 and record every deviation above.
