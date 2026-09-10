# Majlis — System Design

**Status:** Approved, pre-implementation
**Date:** 2026-09-10
**Supersedes:** the previous Majlis build (Hono / Cloudflare Workers / Drizzle) at `../majlis`, which is abandoned in full. Nothing is carried across except the domain rules restated here.

---

## 1. What Majlis is

A single governed system for university club life at one university — club governance, membership, events, registration, attendance, and certificates — replacing spreadsheets, messaging groups, paper forms, and hand-made certificates.

Its promise is singular records: **one verified student identity, one club structure, one registration record, one attendance truth, one certificate history.**

Success is that an event runs end to end without anyone maintaining a parallel spreadsheet — published, registered for, checked in at the door, certified — and that an Admin can later answer *"who attended, and who approved that"* from the audit trail alone.

Attendance is **proved, not asserted**. A signed QR identity pass resolves the person; the server then checks *that person's registration for that specific event* before recording attendance. A certificate is therefore a claim the system can stand behind, and a public verification endpoint lets someone outside the university check it.

### Secondary purpose

This build is also a showcase of the mainstream production Node.js stack. Where two designs are equally correct, prefer the one a hiring team would recognise as current practice.

### Source material

Domain rules are drawn from `Majlis_Internal_Product_and_Curriculum_Specification.docx.md`. That document is a *curriculum* blueprint: its sections 16–19 describe intentionally planted defects, a six-week teaching schedule, and an assessment rubric. **None of that is in scope.** Only the domain model, workflows, business rules, edge cases, and acceptance scenarios are taken from it.

---

## 2. Actors

A person can be more than one of these at once. Authority is always scoped — a role in one club says nothing about another.

| Actor | How assigned | Authority |
|---|---|---|
| **Student** | Self-registers with an email address | Discover clubs and events, request membership, register/cancel, hold one QR identity pass, collect certificates, view own history |
| **Club Lead** | Appointed by an Admin, per club, for a term | Full control of one club: profile, team appointments, events, event assignments, member management |
| **Vice Lead** | Invited by the Lead | Supports club operations; may edit club profile and events, publish events, decide membership requests, and assign event responsibilities. May **not** invite or end team appointments, cancel an event, or override an Admin. |
| **Marketing Officer** | Invited by the Lead | Public description, banner, announcements, registration communication. **No access to attendee personal data by default.** |
| **CTO / Technical Officer** | Invited by the Lead | Technical details, links, equipment and technical notes |
| **Operations Officer** | Invited by the Lead | Registration lists, capacity, QR scanning and check-in, attendance corrections within a controlled window |
| **Platform Admin** | Seeded, or created by another Admin | Everything: users, departments, clubs, Lead appointments, suspension, archival, all records, all reports, overrides |

**Critical distinction:** being a *club member* grants no management permission whatsoever. Membership and team appointment are separate records with separate meanings.

**Lead is singular per club.** Appointing a new Lead ends the previous appointment. Every other officer role may be held by several people in the same club simultaneously.

---

## 3. Decisions ledger

These are settled. Do not re-litigate without asking the human.

### Stack

| Concern | Decision |
|---|---|
| Backend | **NestJS** (TypeScript, decorators, modules) |
| ORM | **Prisma** |
| Database | **Supabase Postgres** |
| Frontend | **Next.js** (App Router) |
| UI | **Tailwind CSS v4 + shadcn/ui** (Radix primitives owned in-repo) |
| Contracts | **Zod** in a shared package, via `nestjs-zod`, generating OpenAPI |
| Auth | **NestJS-native** — Passport, argon2id, httpOnly cookies, rotating refresh tokens. Identity lives entirely in our Postgres. Not Supabase Auth. |
| Background work | **Plain code.** No queue, no Redis, no BullMQ. |
| Client data | TanStack Query + react-hook-form (sharing the Zod schemas) |
| File storage | Supabase Storage, uploaded direct from browser via signed URL |
| PDF | `@react-pdf/renderer` — pure JS, no Chromium |
| Email | Resend, behind a channel adapter interface |
| Logging | Pino, structured, with request IDs and redaction |
| Monorepo | pnpm workspaces + Turborepo |
| Testing | Vitest, Supertest, Playwright, against a **native local Postgres 18** |
| Hosting | **Vercel for both** apps; Supabase for Postgres and Storage |

**Pinned versions**, verified 2026-09-10. Pin these exactly; do not use `latest`.

| Package | Version | Note |
|---|---|---|
| `prisma`, `@prisma/client`, `@prisma/adapter-pg` | **7.10.0** | ⚠️ `prisma@latest` currently resolves to **`8.0.0-rc.13`**, a release candidate. Always pin. |
| `@nestjs/core`, `@nestjs/common`, `@nestjs/swagger` | 12.0.1 | |
| `zod` | 4.6.1 | |
| `nestjs-zod` | 5.5.0 | Zod 4 compatible |
| `next` | 16.3.4 | |
| `tailwindcss` | 4.3.3 | |
| `turbo` | 2.10.12 | |
| `vitest` | 5.0.0 | |
| `nestjs-pino` | 5.1.0 | |
| Node / pnpm | 22.14 / 11.15 | development machine |
| Postgres | 18 | native local install; `postgres:18` in CI |

Prisma 7 notes that shape the setup: **driver adapters are mandatory** (`@prisma/adapter-pg` over `pg`), the new `prisma-client` generator replaces `prisma-client-js` and **requires an explicit `output` path**, and its default output is ESM. Since NestJS is CommonJS, the generator block sets `moduleFormat = "cjs"` — this avoids an ESM migration of the whole API, which interacts badly with decorators and `emitDecoratorMetadata`. Prisma 7 also no longer auto-runs `generate` or `seed`; both are explicit steps.

### Product

- **No approval or review workflow, for clubs or events.** An Admin creating a club makes it active immediately. A Lead publishing an event makes it live immediately. There is no `PENDING_REVIEW` / `PENDING_APPROVAL` state, no `ApprovalDecision` entity, no reviewer queue. Governance is served by Admin suspend / cancel / archive, each written to the audit log with actor, reason, and before/after.
  *Rationale: the Admin creates the club, so an Admin approving it is approving their own work. Event approval is defensible but costs a reviewer UI, a decision entity, and a revision system for material changes, for a loop rarely exercised.*

- **One QR identity pass per user, not per event or registration.** Every user has a single persistent signed pass, reachable from a fixed "My QR" place in the UI. The token carries identity only — never event data. Operations scans it during a specific event's check-in session; the server resolves the user, looks up their registration *for that event*, checks eligibility, and records attendance.

- **QR pass rotation exists.** `POST /me/qr-pass/rotate` bumps `qr_pass.token_version`, which is part of the signed payload and verified on every scan, so the old code dies instantly. This closes the leaked-pass hole; account suspension is no longer the only lever.

- **Public certificate verification exists.** `GET /verify/{code}` is unauthenticated and rate-limited, backed by a public page. It shows holder name, event, club, issue date, and `REVOKED` status where applicable — nothing more. A revoked certificate reports as revoked rather than disappearing.
  *Rationale: a certificate exists to be shown to someone outside the system. Without an external check it is a PDF anyone can forge.*

- **Single university.** Departments group clubs. Multi-tenancy is out of scope and must not be built, though the schema should not preclude it later.

- **English only.** No localisation fields in the schema, no translation layer, no RTL.

- **Timezone is viewer-relative with a venue anchor.** All timestamps stored `timestamptz` in UTC. Each event carries an IANA `timezone` (default `Asia/Dubai`). An event's time renders in **the event's** timezone as the primary value, always labelled; the viewer's detected local time appears as a secondary line **only when it differs**. Non-event timestamps render in the viewer's detected timezone, falling back to `Asia/Dubai` when detection fails, always labelled.
  *Rationale: showing a travelling student "7pm" for an event that starts at 7pm Dubai makes them an hour late.*

- **Attendance eligibility for certificates: check-in only.** Check-in/out and minimum-duration logic are a later additive stage, and the schema must not preclude them.

- **Waitlist with transactional promotion is in scope for the core build**, not deferred.

- **Installable (PWA-style)** via a web app manifest with name, icons, `start_url`, and `display: standalone`. This is an *installability* requirement only. No offline support — scanning requires connectivity, deliberately. No caching service worker beyond the minimum browsers demand for the install prompt.

- **Dark mode is included.**

- **Signup accepts any email address.** Format and uniqueness are the only checks. No domain allow-list.

- **Content fields are plain text columns.** JSONB is reserved for genuinely structured data — eligibility rules, notification payloads, audit before/after snapshots — never for ordinary strings.

- **Brand identity is new.** Nothing from the previous Mbrmj brand guide (navy `#1B3250`, Noto Sans, fixed palette) carries over. The palette, type ramp, and visual language are designed fresh in Stage 3, judged against real screens. Product naming still flows from a single `lib/brand.ts` so a rename is one line.

### Explicitly out of scope

Payments and ticket sales · biometric or facial-recognition attendance · access-control hardware · SMS/WhatsApp delivery · offline scanning and sync · AI recommendations · a social feed · a native mobile app · multi-university tenancy · a certificate template builder · planted defects and any curriculum artifact.

---

## 4. Architecture

### 4.1 Repository

```
majlis/
├── apps/
│   ├── api/                  NestJS
│   └── web/                  Next.js
├── packages/
│   ├── contracts/            Zod schemas + inferred types — single source of truth
│   └── config/               shared tsconfig, eslint, prettier bases
├── docs/
├── turbo.json
├── pnpm-workspace.yaml
└── Dockerfile                API image — portability only, not used locally
```

pnpm workspaces with Turborepo for the `build` / `lint` / `typecheck` / `test` pipeline. TypeScript `strict` throughout. ESLint flat config, Prettier, Husky + lint-staged, conventional commits.

### 4.2 Contract flow

A resource's shape is written **once**, as a Zod schema in `packages/contracts`:

1. `createZodDto()` turns it into a NestJS DTO — validated by a global `ZodValidationPipe`.
2. `@nestjs/swagger` + `nestjs-zod` generate the OpenAPI document from those DTOs.
3. `apps/web` imports the same schemas for `react-hook-form` resolvers.
4. `apps/web` infers response types from the same schemas.

One definition, four consumers, no drift. The OpenAPI document is generated from code and served at `/docs`; it is never hand-written.

### 4.3 Backend structure

One Nest module per bounded context:

`auth` · `users` · `departments` · `clubs` · `club-team` · `memberships` · `events` · `event-assignments` · `registrations` · `qr-pass` · `attendance` · `certificates` · `notifications` · `audit` · `reporting` · `storage` · `health`

**Layering is controller → service → Prisma.** Controllers handle HTTP and DTO validation only. Services own business rules and transactions. Prisma is the data layer; there is no repository abstraction over it — wrapping Prisma in repositories is ceremony that buys nothing here.

**Cross-cutting infrastructure:**

- **`ZodValidationPipe`**, global.
- **Exception filter**, global — emits RFC 9457 `application/problem+json`.
- **`AuthGuard`** — resolves the session from the httpOnly cookie, loads the user, rejects `SUSPENDED` accounts.
- **`PermissionsGuard`** — declarative and DB-derived:

  ```ts
  @RequirePermission('event:publish', { scope: 'club', from: 'params.clubId' })
  ```

  The guard resolves the scope from the request, loads the actor's *current* appointments and platform role from the database, and evaluates. **It never reads a role, club ID, or ownership claim supplied by the client.** Permissions are re-derived on every single request; nothing is cached in the session.

- **`PrismaService` + transaction host** — an AsyncLocalStorage-based ambient transaction context, so a service called deep in a stack enlists in the caller's transaction. This is what makes *"the audit row is written in the same transaction as the action"* structural rather than a discipline someone has to remember.
- **`@nestjs/throttler`** on authentication, scan, and verification endpoints.
- **Pino** with request IDs, and hard redaction of QR tokens, passwords, session tokens, and refresh tokens. No secret ever reaches a log line.

### 4.4 State machines

One `transition()` function per entity, in `clubs/club.state.ts`, `events/event.state.ts`, `registrations/registration.state.ts`. Each is a `from → allowed[]` map plus guard predicates. An illegal transition throws a typed domain error.

**No other code in the codebase assigns a `status` column.** This is enforced by review and by the fact that every status write path goes through the transition function's signature, which requires an actor and a reason.

### 4.5 Deployment

Both apps deploy to Vercel; Postgres and Storage are Supabase.

The known serverless constraints and their resolutions:

| Constraint | Resolution |
|---|---|
| Vercel Hobby cron is daily; the event lifecycle wants ~10 minutes | **Lazy lifecycle** (§7.3) makes tick frequency irrelevant. A free external cron (GitHub Actions scheduled workflow) hits an authenticated sweep endpoint every 10 minutes as a backstop. |
| Cold starts at the door | The bootstrapped Nest instance is cached in module scope, so only true cold starts pay for DI setup. Scanning traffic is continuous during a session, so functions stay warm. The scanner screen fires a health ping on open, before the first student arrives. |
| Prisma connection exhaustion | `DATABASE_URL` on Supabase's transaction pooler (`:6543`, `pgbouncer=true&connection_limit=1`); `DIRECT_URL` on `:5432` for migrations. Row locks work correctly in pgBouncer transaction mode, so §6 concurrency guarantees are unaffected. |
| 4.5 MB request body cap | Club logos upload **direct from browser to Supabase Storage** using a signed URL the API issues after validating declared type and size. Better architecture regardless of host. |
| No WebSockets | Not used. |

A plain `Dockerfile` is committed so the API is portable to Koyeb, Cloud Run, Fly, or a VPS as a configuration change rather than a rewrite. Nothing in `apps/api` may depend on a Vercel-specific API.

Note for the record: Vercel's Hobby tier is non-commercial-use-only under their terms. Acceptable for a showcase; revisit before Majlis bills anyone.

---

## 5. Data model

All timestamps are `timestamptz`, stored UTC. All IDs are UUID v7 (time-sortable) unless stated.

### 5.1 Entities

**`User`** — `id`, `email` (unique, citext), `password_hash` (argon2id), `full_name`, `avatar_url?`, `status` (`ACTIVE` | `SUSPENDED`), `platform_role` (`STUDENT` | `ADMIN`), `created_at`, `updated_at`.
No `university_id`. Majlis serves one university; the email is the unique identity key. Operations verifies a scanned pass against **name + email**.

**`RefreshToken`** — `id`, `user_id`, `token_hash`, `family_id`, `expires_at`, `revoked_at?`, `replaced_by?`, `user_agent?`, `ip?`. Rotation with reuse detection: presenting an already-rotated token revokes the whole family.
Lifetimes: **access token 15 minutes, refresh token 30 days**, both configurable by environment variable.

**`Department`** — `id`, `name` (unique), `code` (unique), `description?`.

**`Club`** — `id`, `department_id`, `name` (unique), `slug` (unique), `description`, `category`, `academic_year`, `logo_url`, `banner_url?`, `membership_policy` (`OPEN` | `APPROVAL_REQUIRED` | `INVITE_ONLY` | `CLOSED`), `status` (`ACTIVE` | `SUSPENDED` | `ARCHIVED`), `created_at`.
Every club has a logo, reused on club pages, its event pages, and its certificates.

**`ClubTeamAppointment`** — `id`, `club_id`, `user_id`, `role` (`LEAD` | `VICE_LEAD` | `MARKETING` | `CTO` | `OPERATIONS`), `status` (`INVITED` | `ACTIVE` | `DECLINED` | `EXPIRED` | `ENDED`), `invited_by`, `invitation_token_hash?`, `invitation_expires_at?`, `term_start?`, `term_end?`, `accepted_at?`, `ended_at?`, `ended_reason?`.
**No permission is active until `status = 'ACTIVE'`.** History is preserved; appointments end, they are never deleted. Invitations expire **7 days** after being sent (configurable); an expired invitation may be resent, which issues a fresh token.

**`ClubMembership`** — `id`, `club_id`, `user_id`, `status` (`PENDING` | `ACTIVE` | `REJECTED` | `LEFT` | `REMOVED`), `requested_at`, `decided_at?`, `decided_by?`, `decision_reason?`.

**`Event`** — `id`, `club_id`, `title`, `slug` (unique **per club**, not globally), `summary`, `description`, `event_type`, `audience`, `venue?`, `online_url?`, `banner_url?`, `timezone` (IANA, default `Asia/Dubai`), `starts_at`, `ends_at`, `registration_opens_at`, `registration_closes_at`, `check_in_opens_at`, `check_in_closes_at`, `capacity`, `confirmed_count` (denormalised counter), `waitlist_enabled`, `requires_club_membership`, `eligibility_rules` (JSONB), `certificate_enabled`, `certificate_title?`, `certificate_signatory?`, `attendance_policy` (`CHECK_IN_ONLY`, extensible), `status`, `cancelled_reason?`, `created_by`, `created_at`.

The check-in window is explicit rather than magic: on creation it defaults to `starts_at − 60 min` … `ends_at + 30 min`, and the club team can adjust it. `ONGOING` is defined as *now within the check-in window*, which is what makes the lazy lifecycle (§7.3) a pure function of timestamps.

**`EventAssignment`** — `id`, `event_id`, `user_id`, `responsibility` (`EVENT_LEAD` | `OPERATIONS` | `MARKETING`), `assigned_by`, `created_at`.
This is the mechanism by which a Lead grants scan rights for a single event to any member without making them a standing officer.

**`EventRegistration`** — `id`, `event_id`, `user_id`, `status` (`CONFIRMED` | `WAITLISTED` | `CANCELLED` | `CHECKED_IN` | `ATTENDED` | `NO_SHOW` | `REMOVED`), `waitlist_position?`, `registered_at`, `cancelled_at?`, `cancelled_by?`, `promoted_at?`, `source` (`SELF` | `ADMIN_OVERRIDE`), `override_reason?`.

**`QrPass`** — `id`, `user_id` (unique — one per user), `token_version` (int), `issued_at`, `last_rotated_at?`.
The pass is a signed token; **no raw token is stored**, only the version that the signature commits to.

**`AttendanceRecord`** — `id`, `registration_id` (unique), `event_id`, `user_id`, `checked_in_at`, `checked_in_by`, `method` (`QR_SCAN` | `MANUAL`), `device_hint?`, `manual_reason?`, `corrected_at?`, `corrected_by?`, `correction_reason?`.

**`Certificate`** — `id`, `registration_id`, `event_id`, `user_id`, `serial_number` (unique, human-quotable), `verification_code` (unique, **128 bits of entropy**, Crockford base32, hyphen-grouped so it can be read aloud), `status` (`ACTIVE` | `REVOKED`), `holder_name_snapshot`, `event_title_snapshot`, `club_name_snapshot`, `club_logo_snapshot_url`, `issued_at`, `pdf_url?`, `revoked_at?`, `revoked_by?`, `revoked_reason?`.
Snapshots are taken at issuance so a later rebrand or club rename cannot retroactively alter an issued certificate. `pdf_url` is null until the PDF is first rendered (§7.5).

**`Notification`** — `id`, `user_id`, `type`, `payload` (JSONB), `dedupe_key` (unique with `user_id`), `read_at?`, `email_status` (`PENDING` | `SENT` | `FAILED` | `SKIPPED`), `email_error?`, `created_at`.

**`AuditLog`** — `id`, `actor_user_id?`, `action`, `entity_type`, `entity_id`, `outcome` (`SUCCESS` | `DENIED`), `reason?`, `before` (JSONB?), `after` (JSONB?), `request_id`, `ip?`, `created_at`.
Append-only. Never contains a raw QR token, password, session token, or refresh token.

### 5.2 Database-enforced invariants

Several of these cannot be expressed in the Prisma schema and require raw SQL in migrations. That is expected and correct — these are the guarantees the product's credibility rests on, and application checks alone do not survive concurrency.

| Invariant | Mechanism |
|---|---|
| One active membership per (user, club) | `CREATE UNIQUE INDEX … ON club_membership (club_id, user_id) WHERE status IN ('PENDING','ACTIVE')` |
| One active registration per (user, event) | Partial unique index on `(event_id, user_id) WHERE status IN ('CONFIRMED','WAITLISTED','CHECKED_IN','ATTENDED','NO_SHOW','REMOVED')`. Only `CANCELLED` is excluded — a student who cancels may register again while the window is open; a `REMOVED` student may not re-register themselves. |
| One active certificate per registration | Partial unique index on `registration_id WHERE status = 'ACTIVE'` |
| Exactly one Lead per club | Partial unique index on `club_id WHERE role = 'LEAD' AND status = 'ACTIVE'` |
| One QR pass per user | Unique on `qr_pass.user_id` |
| Capacity never exceeded | `SELECT … FOR UPDATE` on the event row inside the transaction, **plus** `CHECK (confirmed_count >= 0 AND confirmed_count <= capacity)` on the counter, maintained in that same transaction |
| Waitlist ordering is stable | `waitlist_position` assigned under the same event row lock; promotion uses `FOR UPDATE SKIP LOCKED` over the ordered queue |
| One attendance record per registration | Unique on `attendance_record.registration_id` |
| Certificate identifiers unique | Unique on `serial_number` and on `verification_code` |
| Audit log append-only | No UPDATE or DELETE anywhere in application code; DB-level grant revocation where Supabase permits |
| Registration window sanity | `CHECK (registration_opens_at < registration_closes_at AND registration_closes_at <= ends_at)` |
| Event window sanity | `CHECK (starts_at < ends_at AND check_in_opens_at < check_in_closes_at)` |
| Event slug unique within its club | `UNIQUE (club_id, slug)` |

---

## 6. Permission model

RBAC **with scope**, never a single global role field.

A user has:
- one **platform role** (`STUDENT` or `ADMIN`), and
- zero or more **club-scoped roles**, via `ClubTeamAppointment` rows with `status = 'ACTIVE'`, and
- zero or more **event-scoped responsibilities**, via `EventAssignment`.

An effective permission for an action is derived per request from all three, plus the target's own state (a suspended club freezes new activity; a suspended user can do nothing).

### 6.1 Matrix

| Action | Admin | Lead | Vice | Marketing | CTO | Operations | Member | Student |
|---|---|---|---|---|---|---|---|---|
| Create / suspend / archive club | ✔ | — | — | — | — | — | — | — |
| Appoint Club Lead | ✔ | — | — | — | — | — | — | — |
| Invite / end team appointments | override | ✔ | — | — | — | — | — | — |
| Edit club profile | override | ✔ | ✔ | public fields | technical fields | — | — | — |
| Set membership policy | override | ✔ | ✔ | — | — | — | — | — |
| Decide membership requests | override | ✔ | ✔ | — | — | ✔ | — | — |
| Create / edit / publish event | override | ✔ | ✔ | public fields | technical fields | operational fields | — | — |
| Cancel event | override | ✔ | — | — | — | — | — | — |
| Assign event responsibilities | override | ✔ | ✔ | — | — | — | — | — |
| View attendee personal data | ✔ | ✔ | ✔ | **✘ by default** | ✘ | ✔ for assigned event | — | own only |
| Scan QR / check in | override | ✔ | — | — | — | ✔ | — | — |
| Correct attendance | override | ✔ | — | — | — | ✔ within window | — | — |
| Issue / revoke certificate | ✔ / system | — | — | — | — | — | — | — |
| Register for an event | as student | as student | as student | as student | as student | as student | ✔ | ✔ |
| Read audit log | ✔ | own club, scoped | — | — | — | — | — | — |

Marketing's exclusion from attendee personal data is deliberate and is a least-privilege requirement, not an oversight.

Every Admin override requires a recorded reason and writes an audit row in the same transaction as the overridden action.

### 6.2 Rules

- A user cannot decide their own membership request.
- A user cannot appoint themselves, end their own Lead appointment, or grant themselves a permission.
- A suspended user is rejected at the `AuthGuard`, before any handler runs.
- A suspended club freezes new memberships, new events, and new registrations. Existing records and history remain fully visible.
- An archived club accepts no new activity of any kind.
- Losing an appointment takes effect on the very next request, because permissions are re-derived per request and never cached in the session. A scanner who loses permission mid-event fails their next scan; records already written stand.

---

## 7. Workflows

### 7.1 Club lifecycle

```
ACTIVE ⇄ SUSPENDED
   ↓         ↓
   └──→ ARCHIVED  (terminal)
```

An Admin creates the club with name, department, description, category, academic year, membership policy, and logo — it is `ACTIVE` on creation. The Admin then appoints a Lead by searching existing users; a time-limited invitation is sent. The Lead accepts, completes the profile, and invites Vice Lead, Marketing, CTO, and Operations officers. Each nominee accepts or declines; **no permission is active before acceptance**, and an ignored invitation expires.

There is no submit, no review, no approval.

### 7.2 Membership

| Policy | Behaviour |
|---|---|
| `OPEN` | Joining creates an `ACTIVE` membership immediately |
| `APPROVAL_REQUIRED` | Creates a `PENDING` request; Lead, Vice, or Operations decides |
| `INVITE_ONLY` | Only a valid invitation admits |
| `CLOSED` | No new memberships; existing records stay visible |

A team member automatically receives an ordinary club membership on appointment acceptance, but the two records stay conceptually separate. Leaving a club does not delete historic registrations, attendance, or certificates.

### 7.3 Event lifecycle

```
DRAFT ──→ PUBLISHED ──→ REGISTRATION_CLOSED ──→ ONGOING ──→ COMPLETED ──→ CERTIFIED
  │           │                  │                  │            │
  └───────────┴──────────────────┴──────────────────┴────────────┴──→ CANCELLED
```

| Status | Registration effect |
|---|---|
| `DRAFT` | Not visible outside the club team |
| `PUBLISHED` | Visible; accepts confirmed and waitlisted registrations |
| `REGISTRATION_CLOSED` | Visible; no new registrations |
| `ONGOING` | Check-in window active; scanning enabled |
| `COMPLETED` | Attendance reviewable; no registration changes |
| `CERTIFIED` | Attendance locked; eligible certificates issued |
| `CANCELLED` | Registrants notified; scanning refused; certificates not issued |

**Lazy lifecycle.** An event's *due* status is a pure function of its timestamps and current status. `EventLifecycleService.advance(eventId)` computes the due status and drives the state machine to it — idempotently, in a transaction, writing audit rows. It is called:

1. opportunistically on any read or action that touches the event, and
2. by an authenticated sweep endpoint that an external scheduled job hits every ten minutes.

Either path is sufficient; together they mean no user ever sees a stale status, and the schedule is a backstop rather than the mechanism. Only publication and cancellation are operator-driven; everything else is time-driven.

Only an `ACTIVE` club may publish an event. Cancellation requires a reason, notifies all affected registrants, and refuses all subsequent scans.

### 7.4 Registration, capacity, waitlist

Registration is permitted only while the event is `PUBLISHED` and inside the configured window, and only if the actor passes eligibility (verified account, optional department/year rules, optional required club membership, optional invitation code). Eligibility is evaluated at registration time; a student who later leaves the club keeps a valid registration unless the event explicitly requires continuing membership.

**The last seat, in one transaction:**

1. `SELECT … FOR UPDATE` on the event row.
2. Re-check status, window, and eligibility.
3. If `confirmed_count < capacity` → insert `CONFIRMED`, increment the counter.
4. Else if `waitlist_enabled` → insert `WAITLISTED` with the next `waitlist_position`.
5. Else → reject with 409.
6. Write the audit row.
7. Commit.

Two simultaneous requests for one seat therefore produce exactly one `CONFIRMED`; the loser is waitlisted or rejected, never both confirmed. The partial unique index catches any duplicate that somehow reaches the insert, and `P2002` maps to a clean 409.

**Cancellation** sets `CANCELLED` — it never deletes the row — decrements the counter, then promotes the head of the waitlist atomically in the same transaction (`FOR UPDATE SKIP LOCKED`) and notifies the promoted student.

**Capacity may not be reduced below the confirmed count.** The change is rejected with a clear message; students are never silently cancelled.

**Admin manual registration** applies the same eligibility checks unless an explicit override is used, and an override requires a reason and writes an audit row.

### 7.5 QR pass and check-in

**The token.** A compact signed token (HMAC-SHA256 or Ed25519, key in an environment secret) whose payload is `{ user_id, token_version, issued_at }` and nothing else. **No event data, no personal data.** The signing key never appears in code or logs; a raw token never appears in an audit row.

**Display.** Rendered client-side from a token the API returns to the authenticated owner only, at a fixed "My QR" location. A human-readable fallback code accompanies it for accessibility and for when a camera fails.

**Rotation.** `POST /me/qr-pass/rotate` increments `token_version`. Since the version is inside the signed payload and re-checked on every scan, every previously issued image dies immediately.

**Scanning.** The operator opens the check-in session for a specific event. Each scan is one request carrying the token and the event ID. The server:

1. Verifies the signature and that `token_version` matches the current row.
2. Verifies the scanner's permission **for that event** — Operations officer of the club, an `EventAssignment`, the Lead, or an Admin.
3. Verifies the event is `ONGOING` and inside the check-in window.
4. Verifies the user is `ACTIVE` and the club is not suspended.
5. Looks up that user's registration **for that event**; requires `CONFIRMED`.
6. Inserts the attendance record and transitions the registration to `CHECKED_IN`, with the audit row, all in one transaction.

Results the scanner must render distinctly and unambiguously: **checked in** (with name and email for the operator to eyeball against the person) · **already checked in** (with the original time — never a second record) · **not registered for this event** · **registration cancelled** · **event not open for check-in** · **invalid or superseded pass** · **you are not authorised to scan this event**.

A failure never reveals data about an unrelated student. The unique index on `registration_id` makes double check-in impossible even under two operators scanning simultaneously.

**Manual check-in** requires a student search, a reason, and an audit record. **Attendance corrections** are restricted to Operations and Lead, are time-bound to **48 hours after `ends_at`** (configurable; an Admin may correct after that with a reason), and always write before/after to the audit log. Once the event reaches `CERTIFIED`, attendance is locked and only an Admin override can change it.

### 7.6 Certificates

Issuance begins only once an event reaches `COMPLETED` and attendance is locked, and only if `certificate_enabled`.

`CertificateService.issueForEvent(eventId)` is **idempotent**: it selects registrations eligible under the event's `attendance_policy` (currently `CHECK_IN_ONLY` → status `CHECKED_IN` or `ATTENDED`), and inserts one certificate per registration. The partial unique index on `registration_id WHERE status = 'ACTIVE'` means running it twice cannot produce a duplicate — the second run's conflicting inserts are absorbed, not errors. A `NO_SHOW` never receives one. The event then transitions to `CERTIFIED`.

It is invoked by the same two paths as the lifecycle: opportunistically when a completed event is touched, and by the sweep. No queue.

The **PDF is rendered lazily on first download** (`@react-pdf/renderer`), uploaded to Supabase Storage, and `pdf_url` is filled in. This keeps issuance cheap enough to run inline and avoids rendering thousands of PDFs nobody asks for.

Every certificate carries a unique `serial_number` and a high-entropy `verification_code`, both printed on the PDF alongside the club logo snapshot, and the code is also encoded as a QR on the document.

**`GET /verify/{code}`** is public, unauthenticated, and rate-limited. It returns holder name, event title, club name, issue date, and status — and nothing else, ever. A revoked certificate returns `REVOKED` with the revocation date; it does not vanish.

**Revocation and reissue** are Admin-only, require a reason, and write an audit row. A name correction after issuance produces a reissue: the old record shows `REVOKED`, the new one is `ACTIVE`, and both remain verifiable.

### 7.7 Notifications

A `Notification` row is written in the same transaction as the triggering action, carrying a `dedupe_key` unique per user so a retried action cannot double-notify. An in-app inbox reads these rows.

Delivery goes through a `NotificationChannel` interface. The email implementation uses Resend with React Email templates; failures set `email_status = 'FAILED'` with the error and are visible to an Admin — a failed email never rolls back the action that caused it.

Triggers: team invitation · membership decision · event published · registration confirmed or waitlisted · waitlist promotion · material event change · event cancellation · certificate issued or revoked.

---

## 8. API

REST, versioned under `/api/v1`. OpenAPI generated from the Zod-derived DTOs and served at `/api/v1/docs`.

Conventions: cursor pagination on every list endpoint (**no unbounded list, anywhere**) · consistent `?sort=`, `?filter[…]=` · `ETag` on cacheable reads · idempotency respected on registration and check-in.

| Module | Endpoints |
|---|---|
| Auth | `POST /auth/signup` · `POST /auth/login` · `POST /auth/refresh` · `POST /auth/logout` · `GET /auth/me` |
| Users | `GET/PATCH /me` · `GET /users` · `PATCH /users/{id}/status` |
| Departments | `GET/POST /departments` · `PATCH/DELETE /departments/{id}` |
| Clubs | `GET/POST /clubs` · `GET/PATCH /clubs/{id}` · `PATCH /clubs/{id}/status` · `POST /clubs/{id}/lead` · `POST /clubs/{id}/logo-upload-url` |
| Team | `GET/POST /clubs/{id}/team` · `POST /team-invitations/{token}/accept` · `POST /team-invitations/{token}/decline` · `DELETE /appointments/{id}` |
| Membership | `GET /clubs/{id}/members` · `POST /clubs/{id}/membership-requests` · `PATCH /membership-requests/{id}` · `DELETE /clubs/{id}/membership` |
| Events | `GET /events` · `POST /clubs/{id}/events` · `GET/PATCH /events/{id}` · `POST /events/{id}/publish` · `POST /events/{id}/cancel` · `GET/POST /events/{id}/assignments` |
| Registration | `POST /events/{id}/registrations` · `DELETE /events/{id}/registrations/me` · `GET /events/{id}/registrations` · `GET /me/registrations` |
| QR | `GET /me/qr-pass` · `POST /me/qr-pass/rotate` |
| Attendance | `POST /events/{id}/check-ins` · `POST /events/{id}/check-ins/manual` · `PATCH /attendance/{id}` · `GET /events/{id}/attendance` |
| Certificates | `POST /events/{id}/certificates/issue` · `GET /me/certificates` · `GET /certificates/{id}/pdf` · `POST /certificates/{id}/revoke` · **`GET /verify/{code}`** (public) |
| Notifications | `GET /me/notifications` · `POST /me/notifications/{id}/read` |
| Reporting | `GET /reports/…` · `GET /exports/…csv` |
| Audit | `GET /audit` (Admin) · `GET /clubs/{id}/audit` (Lead, scoped) |
| Ops | `GET /health` · `POST /internal/lifecycle-sweep` (authenticated by a shared secret) |

---

## 9. Frontend

### 9.1 Shells

```
app/
  (public)/                  /login · /signup · /clubs · /clubs/[slug] · /events · /events/[slug] · /verify/[code]
  (student)/                 /home · /me · /me/qr · /me/registrations · /me/certificates
                             mobile-first — bottom tabs: Home · Clubs · Events · My QR · Me
  (club)/manage/[clubId]/    officer console — overview · members · team · events · scan · certificates
  (admin)/admin/             desktop dashboard — metrics · users · departments · clubs · events · audit · exports
```

Route groups do not appear in the URL, so the officer console lives under `/manage/[clubId]` rather than `/clubs/[clubId]` — the latter would collide with public club discovery at `/clubs/[slug]`. Public club and event pages are addressed by slug; management pages by ID.

`middleware.ts` gates cheaply on cookie presence, with the routing rules as pure, unit-tested functions. Each shell's `layout.tsx` then re-verifies the real user and their club-scoped roles **server-side** and redirects if they don't belong.

**Never render a page and then show an "authentication required" panel inside it. Redirect instead.**

`/` redirects by role: Admin → `/admin`; officer-only → their club console; otherwise → `/home`. There is no landing page — Majlis is an authenticated product. A person who is both a student and an officer gets a shell switcher.

### 9.2 Data fetching

Hybrid, chosen per surface. React Server Components for first-paint-critical reads (public discovery, admin tables, server-side role gating in layouts). TanStack Query on the client for interactive surfaces (scanner, registration, inbox, anything optimistic). One generated typed client, callable from both.

A Next.js rewrite maps `/api/v1/*` to the API deployment, so the browser sees a **same origin**: the session cookie is first-party, and there is no CORS at all.

### 9.3 Mobile

The student shell must read as an application, not a website: fixed bottom tab bar, `env(safe-area-inset-*)` respected top and bottom, sticky contextual headers, `100dvh` handling, sheet-style modals, `overscroll-behavior` containment to kill rubber-banding, tap targets ≥ 44 px, no layout shift on navigation.

Installability: `manifest.webmanifest` with name, maskable icons, `start_url`, and `display: standalone`; a minimal service worker only insofar as the target browsers require one to offer the install prompt. **No offline caching.**

Motion is light and always `prefers-reduced-motion`-aware. No custom gesture system.

### 9.4 Scanner

The hard case: used one-handed, standing, in a queue, under time pressure, possibly by several operators at once. `BarcodeDetector` where available with a `zxing-js` fallback; screen wake-lock held while the session is open; haptic feedback on result; result states that are oversized, colour-plus-icon-plus-text (never colour alone), and readable at arm's length; a running checked-in/expected counter; a prewarm ping on open. There is no mode the operator must remember to set.

### 9.5 Design

The visual identity is designed fresh in Stage 3 and judged against real screens, not chosen in the abstract. Product and company naming flow from `lib/brand.ts` so a rename is one line and never hardcoded in a component. Dark mode is a first-class theme, defined in tokens rather than bolted on.

**WCAG 2.2 AA is the target and must be verified, not asserted:** 4.5:1 on body text (3:1 large and UI), a complete keyboard path with a visible focus indicator, no meaning carried by colour alone, labelled controls with errors announced, `prefers-reduced-motion` respected. Any palette that fails this is rejected at design time, not patched later.

---

## 10. Error handling

**API** — RFC 9457 `application/problem+json` with `type`, `title`, `status`, `detail`, `instance`, and an `errors[]` array for field-level validation failures. Domain errors are typed exceptions mapped by the global filter. Internals never leak; the response carries a request ID that correlates to the structured log.

Prisma `P2002` (unique violation) and serialization failures map to **409 with a retry hint**, never a 500 — under concurrency these are expected outcomes, not faults.

A permission denial writes an audit row with `outcome = 'DENIED'` and returns 403 (or 404 where revealing existence would itself leak information).

**Web** — per-shell error boundaries, inline field errors driven by `errors[]`, toasts for mutation failures, a failed-fetch banner. Scanner failures are loud and unambiguous by design.

Where a viewer lacks access, or a club is suspended, or something genuinely went wrong, the product **says the true thing** rather than showing an empty screen.

---

## 11. Security

- Server-side authorization on every protected endpoint, re-derived from the database per request. No exceptions. The UI hiding a control is presentation, never protection.
- argon2id password hashing with sane parameters. httpOnly, `Secure`, `SameSite=Lax` cookies. Refresh rotation with family-wide revocation on reuse detection.
- Rate limiting on login, signup, scan, and `/verify/{code}`.
- QR signing keys, session secrets, the sweep secret, and the Resend key live in environment secrets. Never in code, never in a log, never in an audit row.
- Least privilege on attendee personal data — Marketing does not see it; Operations sees it only for their assigned event; students see only their own.
- Input validation at the boundary via Zod; uploaded images validated for declared type and size before a signed URL is issued.
- Structured logging with redaction; a health endpoint that exposes nothing sensitive.
- Every approval, role change, scan, issuance, revocation, and Admin override writes an `AuditLog` row **in the same transaction as the action itself**, or the action did not happen.

---

## 12. Testing

| Layer | Tool | Covers |
|---|---|---|
| Unit | Vitest | State machines, permission derivation, eligibility rules, waitlist ordering, certificate eligibility, timezone rendering, middleware route rules. Pure functions, fast. |
| Integration | Vitest + Supertest against a **real Postgres 18** | Every endpoint against the real constraints. Mocking the DB would test nothing, because the invariants *are* the constraints. Locally this is a native Postgres 18 install with a dedicated `majlis_test` database, migrated once per run and truncated between tests; in CI it is a GitHub Actions `postgres:18` service container. Testcontainers was dropped because the development machine has no Docker. |
| Concurrency | Vitest + real DB | N parallel requests for the last seat → exactly one `CONFIRMED`. Simultaneous double scan → one attendance row. Issuance run twice → one certificate. Concurrent cancellation + promotion → no lost or duplicated seat. |
| Authorization | Vitest + Supertest | A matrix over every protected endpoint × every role that must not reach it — explicitly including the IDOR case, where a member of club A addresses club B's event by ID. |
| E2E | Playwright | Admin creates club + appoints Lead → Lead invites Operations → Lead creates and publishes event → student registers → Operations scans → attendance recorded → certificate issued → public verification resolves. Plus a mobile-viewport pass and an accessibility pass. |

CI on GitHub Actions: typecheck → lint → unit → integration → build → Playwright. Seeded demo data supports every persona.

### Acceptance scenarios

Drawn from the source spec; each becomes a test.

1. An Admin appoints a verified student as Lead; on acceptance, club-scoped Lead permissions become active and the action is audited.
2. An ordinary club member attempting to create an event through the API is denied, even knowing the club ID.
3. Two simultaneous eligible requests for the last seat never produce two confirmations.
4. A cancelled registration's QR scan creates no attendance and returns an invalid-status response.
5. A confirmed registration scanned twice creates no duplicate and shows the original check-in time.
6. Certificate generation for a `NO_SHOW` creates nothing.
7. Certificate generation run twice leaves exactly one active certificate.
8. A rotated QR pass invalidates every previously issued image immediately.
9. A revoked certificate's verification code resolves and reports `REVOKED`.
10. A scanner who loses their appointment mid-event fails their next scan; records already written stand.

---

## 13. Build stages

Each stage ships complete — migrations applied, endpoints tested, screens working — before the next begins. Deviations are recorded in this document as they happen, so the plan stays trustworthy.

| # | Stage | Contents |
|---|---|---|
| 1 | Foundation | Monorepo, Turborepo, contracts package, Prisma schema + first migrations with all constraints, test database harness, health endpoint, transaction host, Problem Details filter, CI, seed script |
| 2 | Auth & users | Signup, login, refresh rotation, logout, session guard, permission guard skeleton, user suspension, audit writer, transaction host |
| 3 | Design system & shells | Visual identity, tokens, dark mode, shadcn component layer, the three shells, role routing, PWA manifest, accessibility baseline |
| 4 | Clubs & team | Departments, club CRUD + status machine, logo upload via signed URL, Lead appointment, team invitations and acceptance |
| 5 | Membership | Four policies, requests and decisions, member lists, leaving |
| 6 | Events | Event CRUD, lifecycle state machine, lazy advance + sweep endpoint, publication, cancellation, event assignments |
| 7 | Registration | Eligibility, window, capacity under lock, waitlist, transactional promotion, cancellation, admin override |
| 8 | QR & attendance | Pass issuance, rotation, signed token, scanner UI, check-in, manual check-in, corrections |
| 9 | Certificates | Idempotent issuance, lazy PDF render, storage, public verification page, revoke and reissue |
| 10 | Notifications | Notification records, in-app inbox, channel abstraction, Resend email, all triggers |
| 11 | Reporting | Club/event/attendance/certificate metrics, CSV exports, audit log viewer |
| 12 | Hardening & deploy | Rate limits, security review, Lighthouse and accessibility verification, load sanity check on the scan path, Vercel deployment, runbook |

---

## 14. Open items

- The visual identity itself — palette, type ramp, component language — is deliberately deferred to Stage 3 and will be presented for approval before the shells are built.
- The check-in/out and minimum-duration attendance policies are a later additive stage. `event.attendance_policy` is an enum with room to grow, and adding check-out is a nullable column plus a new branch in the eligibility function — no restructuring. **No unused columns are added now.**
- This spec covers twelve stages and will therefore produce **one implementation plan per stage**, not a single monolithic plan. Stage 1's plan is written first; each subsequent stage is planned when the previous one is done, so later plans can absorb what earlier stages taught us.
- Vercel Hobby's non-commercial terms must be revisited before Majlis serves a paying customer.
