# Stage 6 — Attendance & certificates

Branch `stage-6-attendance-certificates`. Four tasks, two dispatches (1-3 API, 4 web),
one combined code and security review at the end.

**No migration.** Every invariant this stage rests on shipped in
`20260910204454_attendance_certificates`: `attendance_record_registration_id_key`,
`certificate_one_active_per_registration` (partial, `WHERE status = 'ACTIVE'`),
`certificate_serial_number_key` and `certificate_verification_code_key`.
`PermissionsGuard` already resolves `scope: 'event'` and, for an event, its club's
roles too, which is what makes an `EventAssignment` grant scan rights without a
standing officer role.

## Decisions taken here

**The token is HMAC-SHA256, not Ed25519.** `node:crypto`, no dependency. Payload is
16 bytes of user id, 2 bytes of `tokenVersion`, 4 bytes of epoch seconds; signature is
the HMAC truncated to 16 bytes. Wire form `v1.<base64url payload>.<base64url sig>`,
about 51 characters, which keeps QR density low enough to decode at arm's length in a
badly lit hall. No event data, no personal data, per §7.5.

**There is no typed fallback credential.** §7.5 asks for "a human-readable fallback
code"; the product decision is that a camera failure falls through to manual check-in
keyed by the student's **email**, which the operator can already read off the person.
That deletes an entire second credential format, a second verification path and a
second thing to get wrong. Manual check-in still writes `method = 'MANUAL'`, a reason
and an audit row.

**`QR_SIGNING_SECRET` is a new env value**, minimum 32 characters, with an example
default refused in production exactly like `SESSION_SECRET` and
`LIFECYCLE_SWEEP_SECRET`.

**Redaction: the token travels in a POST body and nowhere else.**
`log-redaction.ts` documents, in its own header comment, that pino-http never
serializes a request body, so a `req.body.*` path is inert and must not be added
back. What lands in this stage's first commit instead is `req.query.pass` (defensive,
in case a later change moves the token into a query string) plus two tests: one
asserting the serialized request shape carries no body key at all, one asserting
`QR_SIGNING_SECRET`'s value appears in no boot log line.

**Seven scan results, two transports.** `NOT_AUTHORISED` is a 403 Problem Details
written by `PermissionsGuard` with a `DENIED` audit row, because it is a request
fault. The other six are `200` with a `result` discriminant, because they are
outcomes the operator must read, not client errors:

| `result` | Extra fields |
|---|---|
| `CHECKED_IN` | `fullName`, `email`, `checkedInAt` |
| `ALREADY_CHECKED_IN` | `fullName`, `email`, `checkedInAt` (the original) |
| `NOT_REGISTERED` | none |
| `REGISTRATION_CANCELLED` | none |
| `EVENT_NOT_OPEN` | `eventStatus` |
| `INVALID_PASS` | none |

Only the two success shapes carry personal data. A failure never names a student,
which is what keeps a mis-scan from leaking an unrelated person's identity.

**Unscanned registrations become `NO_SHOW` at `COMPLETED`,** in the same transaction
as that lifecycle hop, inside `EventLifecycleService.advanceRow`. Remaining
`CONFIRMED` and `WAITLISTED` rows only. This makes the roster truthful after an event
and gives "a `NO_SHOW` never receives a certificate" something real to assert against,
rather than relying on the absence of a row.

**`COMPLETED` → `CERTIFIED` fires at `endsAt + ATTENDANCE_CORRECTION_WINDOW_HOURS`,
not at `COMPLETED`.** §7.5 gives Operations and Lead 48 hours after `endsAt` to
correct attendance; §7.6 says attendance locks at `CERTIFIED`. Issuing the moment an
event completes would make that 48-hour window zero. So issuance is gated on the
correction window having closed, which keeps the hop a pure function of the clock like
every other transition. An event with `certificateEnabled: false` stays `COMPLETED`
forever, because `CERTIFIED` means certificates were issued.

**Issuance is invoked, never scheduled.** `CertificatesService.issueForEvent` depends
on nothing in `events/`, so `EventsService` calls it after `advance()` on single-event
reads and actions, and `LifecycleSweepController` calls it per swept row. No cycle,
no queue.

**No rate limit on `/verify/{code}`.** Deferred to Stage 8 with the rest, decided
2026-09-12: the code carries 128 bits of entropy and the route is one indexed read.
The entropy is the whole protection: a miss answers 404 and a hit answers 200, sooner,
so the route is perfectly distinguishable and there is simply nothing to enumerate.
What the fixed response shape does instead is cap disclosure on a hit, to spec 7.6's
six fields and nothing else.

**New dependencies:** `qrcode@1.5.4` and `@types/qrcode@1.5.6` in both apps,
`@react-pdf/renderer@4.9.0` and `react@19.3.0` in the API. `@react-pdf/renderer`
peers on `react` only — it ships its own reconciler, so no `react-dom`. All verified
present on npm and well past the 48-hour rule.

---

## Task 1 — Contracts, token, pass

**Files**

- Create `packages/contracts/src/attendance/index.ts` + `index.test.ts`
- Create `apps/api/src/attendance/qr-token.ts` + `qr-token.spec.ts`
- Create `apps/api/src/attendance/qr-pass.service.ts`, `qr-pass.controller.ts`,
  `attendance.module.ts`
- Modify `apps/api/src/config/env.schema.ts` (+ spec), `log-redaction.ts` (+ spec),
  `packages/contracts/src/index.ts`, `apps/api/src/app.module.ts`

**Routes**

- `GET /me/qr-pass` → `{ token, tokenVersion, issuedAt }`. Creates the row on first
  call. Owner only, never another user's; there is no route that returns anyone
  else's token.
- `POST /me/qr-pass/rotate` → the same shape with `tokenVersion + 1`, audit
  `qr_pass.rotated` in the same transaction.

**Invariants**

- `qr_pass.user_id` is unique. First call races itself; handle `P2002` by re-reading,
  not by failing.
- `verifyPass` compares with `crypto.timingSafeEqual` and returns a discriminated
  `{ ok: true, payload } | { ok: false, reason: 'MALFORMED' | 'BAD_SIGNATURE' }`.
  A malformed token must never throw.

**What gets tested**

Rotation kills every previously issued image: sign a token, rotate, verify the old
token's version no longer matches the row. Signature tampering. A token signed with a
different secret. The two redaction tests named above.

---

## Task 2 — Check-in, corrections, no-show

**Files**

- Create `apps/api/src/attendance/attendance.service.ts`, `attendance.controller.ts`
- Modify `apps/api/src/auth/permissions.ts`,
  `apps/api/src/events/event-lifecycle.service.ts`

**Permissions added**

| Key | Platform | Club | Event |
|---|---|---|---|
| `attendance:scan` | `ADMIN` | `LEAD`, `OPERATIONS` | `EVENT_LEAD`, `OPERATIONS` |
| `attendance:correct` | `ADMIN` | `LEAD`, `OPERATIONS` | — |

Vice Lead is deliberately absent from both: §6.1's "Scan QR / check in" and "Correct
attendance" rows tick Lead and Operations only.

**Routes** (all `scope: 'event'`, `from: 'params.eventId'`)

- `POST /events/:eventId/check-in/scan` — body `{ token, deviceHint? }`
- `POST /events/:eventId/check-in/manual` — body `{ email, reason }`, same result
  union, `method = 'MANUAL'`
- `GET /events/:eventId/attendance` — cursor page plus `{ checkedIn, expected }`.
  Requires `registration:read`, not `attendance:scan`: it is a bulk read of personal
  data, and §6.1 keeps Marketing and CTO out of it.
- `PATCH /events/:eventId/attendance/:registrationId` — body
  `{ present: boolean, reason, override?: { reason } }`

**The scan transaction**, in order, all inside one `host.run`:

1. `verifyPass`; on failure return `INVALID_PASS` and stop.
2. Load `qr_pass` by user id; `tokenVersion` mismatch → `INVALID_PASS`.
3. `advance()` the event **before** opening the transaction, per the warning in
   `EventLifecycleService.advance`'s own docblock.
4. Event not `ONGOING`, or now outside the check-in window → `EVENT_NOT_OPEN`.
5. User not `ACTIVE`, or club suspended → `INVALID_PASS` (never a message that
   confirms the person exists).
6. No registration → `NOT_REGISTERED`; `CANCELLED` or `REMOVED` →
   `REGISTRATION_CANCELLED`; already `CHECKED_IN` or `ATTENDED` →
   `ALREADY_CHECKED_IN` with the original `checkedInAt`.
7. Insert `AttendanceRecord`, transition the registration to `CHECKED_IN`, write the
   audit row. All three or none.

**Invariants**

- Unique `attendance_record.registration_id` is what makes step 7 safe under two
  operators. A `P2002` on that constraint is caught and answered as
  `ALREADY_CHECKED_IN`, never a 500 and never a second row.
- The correction window is `endsAt + ATTENDANCE_CORRECTION_WINDOW_HOURS` (env,
  default 48). Past it, Operations and Lead get `UnprocessableError`; an `ADMIN` with
  an `override.reason` passes and the audit row records `before` and `after`.
- Once the event is `CERTIFIED`, only an `ADMIN` override may correct.

**What gets tested**

Double check-in under two genuinely concurrent operators produces one row, proven by
dropping `attendance_record_registration_id_key` and watching it produce two. One
allowed and one refused role for each of the two new permissions, **including an
`EventAssignment` holder with no club role reaching the scan route**. The correction
window boundary either side, and the Admin crossing it. Registration status
`NO_SHOW` after the event completes.

---

## Task 3 — Certificates, PDF, public verification

**Files**

- Create `packages/contracts/src/certificates/index.ts` + `index.test.ts`
- Create `apps/api/src/certificates/certificate-codes.ts` + `.spec.ts`,
  `certificates.service.ts`, `certificates.controller.ts`, `verify.controller.ts`,
  `certificate-pdf.tsx`, `certificates.module.ts`
- Modify `apps/api/src/storage/storage.service.ts` (add `putObject`),
  `apps/api/src/storage/image-kinds.ts` (a `certificate-pdf` path),
  `apps/api/src/auth/permissions.ts`, `apps/api/src/events/events.service.ts`,
  `apps/api/src/events/lifecycle-sweep.controller.ts`,
  `apps/api/src/app.module.ts`, `apps/api/tsconfig*.json` (`"jsx": "react-jsx"`)

**Permission added:** `certificate:manage` → `{ platform: ['ADMIN'] }`. §6.1's
"Issue / revoke certificate" row is Admin and system only; no club role appears in it.

**Routes**

- `POST /events/:eventId/certificates/issue` — `certificate:manage`, idempotent
- `GET /events/:eventId/certificates` — `registration:read`, cursor page
- `GET /me/certificates` — cursor page, own rows only, no permission key
- `GET /certificates/:id/pdf` — owner or `ADMIN`; renders and uploads on first call
- `POST /certificates/:id/revoke` — `certificate:manage`, `{ reason }` required
- `POST /certificates/:id/reissue` — `certificate:manage`, `{ reason }` required
- `GET /verify/:code` — `@Public()`, returns `{ status, holderName, eventTitle,
  clubName, issuedAt, revokedAt? }` and nothing else, ever

**Codes**

`serialNumber` is `MJL-<year>-<8 Crockford base32 chars>`, human-quotable.
`verificationCode` is 128 bits of `crypto.randomBytes` in Crockford base32, grouped
in fives with hyphens so it can be read aloud. Crockford's alphabet excludes I, L, O
and U, which is the whole point; do not substitute a stock base32.

**`issueForEvent(eventId)`**

Refuses unless status is `COMPLETED`, `certificateEnabled` is true and
`now > endsAt + correctionWindow`. Selects registrations eligible under
`attendancePolicy` (`CHECK_IN_ONLY` → `CHECKED_IN` or `ATTENDED`), inserts one
certificate each with all four snapshot columns filled, transitions the event to
`CERTIFIED` via `assertTransition` plus a conditional `updateMany`, writes one audit
row. A `P2002` on `certificate_one_active_per_registration` is **absorbed, not
raised** — that is the idempotency mechanism, not an error.

**Invariants**

- Running `issueForEvent` twice yields exactly one certificate per registration.
- A `NO_SHOW` registration receives none.
- `serialNumber` and `verificationCode` are unique; a collision retries rather than
  500s.
- Revoke sets `REVOKED` with `revokedAt`, `revokedById` and `revokedReason`; the row
  stays verifiable and `/verify` returns `REVOKED` plus the revocation date.
- Reissue revokes the old row and inserts a fresh `ACTIVE` one in the same
  transaction, with new snapshots. Both remain verifiable.
- Snapshot columns are written at issuance and never updated. Renaming the club must
  not alter an issued certificate.

**What gets tested**

Issuance twice → one certificate. A `NO_SHOW` gets none. One allowed and one refused
role on `certificate:manage`. `/verify` on an unknown code and on a revoked one,
asserting the **detail message** and that no field beyond the six named above appears
in either response.

---

## Task 4 — Web

**Files**

- Create `apps/web/src/app/error.tsx` and one per shell: `(student)`, `(club)`,
  `(admin)`, `(auth)`
- Create `apps/web/src/app/(public)/verify/[code]/page.tsx` and that group's
  `layout.tsx`
- Fill `apps/web/src/app/(student)/me/qr/page.tsx`,
  `(student)/me/certificates/page.tsx`,
  `(club)/manage/[clubId]/scan/page.tsx`,
  `(club)/manage/[clubId]/certificates/page.tsx`
- Create `apps/web/src/components/scanner/` (camera, result card, counter, manual
  form)
- Modify `apps/web/src/middleware.ts` to let `/verify/*` through unauthenticated

**The scanner**, §9.4, and the one screen that must work one-handed in a noisy hall:

- `BarcodeDetector` only, no zxing (decided 2026-09-12). Where it is missing, the
  screen says so once and offers the email form, rather than pretending to scan.
- Screen wake lock held while the session is open, released on unmount.
- Result card is oversized and readable at arm's length, colour **plus** icon
  **plus** text, never colour alone.
- Haptic on result where `navigator.vibrate` exists: one pulse for success, two for
  refusal.
- A running checked-in / expected counter.
- A prewarm request on open, so the first real scan is not also the first connection.
- No mode the operator has to remember to set.

**`error.tsx`** is the gap the handoff names first. Every client `load()` effect
currently rejects unhandled on anything that is not a 404 or 403, so a session
revoked mid-use leaves the screen on its skeleton forever. Each boundary offers
retry, and a 401 sends the viewer to `/login`.

**The public shell** is new. The handoff records "no `(public)` route group" as a
deliberate Stage 4 simplification; `/verify/[code]` is the one anonymous route in the
product and is the reason to add it now. It gets no bottom tabs, no shell switcher,
and no navigation into the authenticated product.

**What gets tested**

Playwright walks the seeded acceptance path to its end: Operations scans, attendance
is recorded, the certificate issues, `/verify/{code}` resolves while signed out. Plus
an axe pass on the four new screens and a mobile-viewport pass on the scanner.

---

## Verification before the review

```bash
pnpm typecheck && pnpm lint && pnpm test
pnpm --filter @majlis/api test:integration
API_ORIGIN=http://localhost:3001 pnpm build
pnpm --filter @majlis/web test:e2e     # restart next dev first
```

Then `/code-review` and `/security-review` together, once, over the whole branch.
Fix what they find. Tick Stage 6 in spec §13 and record every deviation above.
