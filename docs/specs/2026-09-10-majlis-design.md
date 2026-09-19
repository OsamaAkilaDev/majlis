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
| Auth | **NestJS-native** — argon2id, httpOnly cookies, revocable refresh tokens, guards written directly. Identity lives entirely in our Postgres. Not Supabase Auth. ~~Passport~~ — dropped 2026-09-11, see Stage 2 design §9.1. |
| Background work | **Plain code.** No queue, no Redis, no BullMQ. |
| Client data | TanStack Query + react-hook-form (sharing the Zod schemas) |
| File storage | Supabase Storage, uploaded direct from browser via signed URL |
| PDF | `@react-pdf/renderer` — pure JS, no Chromium |
| Email | Resend, behind a channel adapter interface |
| Logging | Pino, structured, with request IDs and redaction |
| Monorepo | pnpm workspaces + Turborepo |
| Testing | Vitest, Supertest, Playwright, against a **native local Postgres 18** |
| Hosting | **Vercel** for the web app, **Render** for the API; Supabase for Postgres and Storage. Revised 2026-09-15, see 4.5 |

**Pinned versions**, verified 2026-09-10. Pin these exactly; do not use `latest`.

| Package | Version | Note |
|---|---|---|
| `prisma`, `@prisma/client`, `@prisma/adapter-pg` | **7.10.0** | ⚠️ `prisma@latest` currently resolves to **`8.0.0-rc.13`**, a release candidate. Always pin. |
| `@nestjs/core`, `@nestjs/common`, `@nestjs/swagger` | 12.0.1 | |
| `zod` | 4.5.4 | |
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

- **The client Router Cache holds a dynamic page for 30 seconds**, set by `experimental.staleTimes.dynamic` in `apps/web/next.config.ts`. Every write the client makes then refreshes the router, wired once in `lib/api.ts` and registered by `components/RouterCacheInvalidator.tsx`.
  *Rationale: every screen reads `cookies()` and fetches `no-store`, so all of them are dynamic, and Next's default of 0 means the cache keeps nothing for them. Leaving a page and returning re-requested the whole RSC payload and showed `loading.tsx` again, on data that had not changed. Verified by A/B against a build with the value at 0: the return navigation issues one RSC request at 0 and none at 30. The refresh-on-write is what stops the saved 30 seconds being paid for with a seat count from before the registration.*

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

The **web app deploys to Vercel**. The **API deploys to Render** as a persistent Node
process, configured by `render.yaml` at the repository root. Postgres and Storage are
Supabase. Revised 2026-09-15; see §14 for why the API moved.

The short version: **NestJS 12 is ESM-only** and this app compiles to CommonJS, so it
depends on Node's `require(esm)`, unflagged in 22.12. A normal `node` process on Node 22
has it; Vercel's function loader does not, and every request died with `ERR_REQUIRE_ESM`
before a route could run. **Node 22.12 is therefore a hard floor for this project.**

Constraints and their resolutions, as they actually stand:

| Constraint | Resolution |
|---|---|
| Nothing calls the two sweep endpoints on a schedule | **Lazy lifecycle** (§7.3) makes tick frequency irrelevant for status. Certificate issuance and notification delivery do need a tick. A free external cron (a GitHub Actions scheduled workflow) hitting the authenticated sweep endpoints is the intended backstop and is not built. |
| Render's free instances spin down after inactivity | A cold start costs roughly a minute. Acceptable for a showcase, not for a check-in desk: the scanner screen should fire a health ping on open, well before the first student arrives. Paid instances do not spin down. |
| Prisma connections | `DATABASE_URL` and `DIRECT_URL` both on Supabase's **session** pooler (`:5432`). A persistent server wants real sessions, and migrations cannot run through the transaction pooler. The transaction pooler (`:6543`) is the right answer only for serverless. |
| The direct `db.<ref>.supabase.co` host is **IPv6-only** | Use the pooler hostnames, which have IPv4. This broke the first deployment's migrations with `P1001` and is invisible from a machine that has IPv6. |
| 4.5 MB request body cap | Club logos upload **direct from browser to Supabase Storage** using a signed URL the API issues after validating declared type and size. Kept: better architecture regardless of host. |
| No WebSockets | Not used. |

Migrations run in the build, before the new instance serves traffic, so a schema change
ships with the commit that makes it and a failed migration fails the deploy rather than
starting a server against the wrong schema. `prisma generate` is part of `pnpm build`
rather than only `postinstall`, because a cached or skipped install must not leave the
generated client missing.

No `Dockerfile` is committed. An earlier version of this section claimed one was; it never
existed. Nothing in `apps/api` depends on a host-specific API, so portability to Koyeb,
Fly, Cloud Run or a VPS remains a configuration change rather than a rewrite.

---

## 5. Data model

All timestamps are `timestamptz`, stored UTC. All IDs are UUID v7 (time-sortable) unless stated.

### 5.1 Entities

**`User`** — `id`, `email` (unique, citext), `password_hash` (argon2id), `full_name`, `avatar_url?`, `status` (`ACTIVE` | `SUSPENDED`), `platform_role` (`STUDENT` | `ADMIN`), `created_at`, `updated_at`.
No `university_id`. Majlis serves one university; the email is the unique identity key. Operations verifies a scanned pass against **name + email**.

**`RefreshToken`** — `id`, `user_id`, `token_hash`, `family_id`, `expires_at`, `revoked_at?`, `replaced_by?`, `user_agent?`, `ip?`. The token is **revocable, not rotating** — it stays valid until logout, suspension, or expiry (simplified 2026-09-11, see §13). `family_id` identifies one login's session; `replaced_by` is vestigial.
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
- argon2id password hashing with sane parameters. httpOnly, `Secure`, `SameSite=Lax` cookies. Refresh tokens are opaque, stored only as SHA-256 hashes, and revoked on logout and on suspension. ~~Rotation with family-wide revocation on reuse detection~~ — dropped 2026-09-11 as disproportionate for this system; see §13.
- Rate limiting on login, signup, scan, and `/verify/{code}` — **all of it in Stage 12**, none of it today.
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
| 1 | ✅ **Done** — Foundation | Monorepo, Turborepo, contracts package, Prisma schema + all migrations with every constraint, test database harness, health endpoint, transaction host, Problem Details filter, CI, seed script |
| 2 | ✅ **Done** — Auth & users | Signup, login, refresh rotation, logout, session guard, permission guard, user suspension, audit writer. Designed in [`2026-09-11-stage-2-auth-design.md`](2026-09-11-stage-2-auth-design.md) |
| 3 | ✅ **Done** — Design system & shells | Visual identity, tokens, dark mode, shadcn component layer, the three shells, role routing, PWA manifest, accessibility baseline. Designed in [`2026-09-11-stage-3-shells-design.md`](2026-09-11-stage-3-shells-design.md) |
| 4 | ✅ **Done** — Clubs, team & membership | Departments, club CRUD + status machine, image upload via signed URL, Lead appointment, in-app team invitations, the four membership policies, requests and decisions, member lists, leaving. Designed in [`2026-09-12-stage-4-clubs-team-membership-design.md`](2026-09-12-stage-4-clubs-team-membership-design.md) |
| 5 | ✅ **Done** — Events & registration | Event CRUD, lifecycle state machine, lazy advance + sweep endpoint, publication, cancellation, event assignments, eligibility, registration window, capacity under lock, waitlist, transactional promotion, admin override. Field-level edit permissions, deferred from Stage 4, built here and applied to clubs too. Planned in [`2026-09-12-stage-5-events-registration.md`](../superpowers/plans/2026-09-12-stage-5-events-registration.md) |
| 6 | ✅ **Done** — Attendance & certificates | Pass issuance, rotation, signed token, scanner UI, check-in, manual check-in, corrections, then idempotent issuance, lazy PDF render, storage, public verification page, revoke and reissue. Planned in [`2026-09-12-stage-6-attendance-certificates.md`](../superpowers/plans/2026-09-12-stage-6-attendance-certificates.md) |
| 7 | ✅ **Done** — Notifications & reporting | Notification records, in-app inbox, channel abstraction, Resend email, all triggers, club/event/attendance/certificate metrics, ~~CSV exports~~ (deleted 2026-09-16), audit log viewer. Password reset added here. Planned in [`2026-09-13-stage-7-notifications-reporting.md`](../superpowers/plans/2026-09-13-stage-7-notifications-reporting.md) |
| 8 | ✅ **Done**: Hardening | Whole-codebase security audit and nine fixes, six performance fixes, the em dash sweep, the README rewrite and the operator handbook. **No rate limiting and no deployment**, both decided 2026-09-13. Planned in [`2026-09-13-stage-8-hardening.md`](../superpowers/plans/2026-09-13-stage-8-hardening.md) |

### How a stage is built, revised 2026-09-12 after Stage 4

Stage 4 shipped correct and took far too long. The cost was process, not code:
twelve tasks, each with its own dispatch, its own review, and nearly always a
fix round. Three round trips per task. The reviews found real defects, so the
answer is fewer and later reviews, not none.

**One stage is two dispatches and one review.**

1. **Design.** No separate stage design document unless the stage introduces
   architecture this spec does not already settle. Decisions go inline in the
   plan. Stage 4's design doc was 3000 words and its only load-bearing parts
   were four decisions.
2. **Plan.** Three to five tasks, not twelve. A task is "the API half", not "one
   endpoint". Name the files, the routes and the invariants; do not write out
   every test.
3. **Build.** One dispatch for the API half, one for the web half. Commit per
   section inside a dispatch so work is recoverable.
4. **Review once, at the end of the stage**, combining code and security. Fix
   only what it finds. If it finds nothing, merge.

**What still gets tested, and nothing beyond it:**

- Database invariants, each proven by deliberately breaking the constraint.
- Authorization: for each permission, one allowed role and one refused role.
- State machines: the transitions that must be refused.
- Anything that has already broken once.

Not tested: every branch of every guard, every 404 path, every field of every
response. Stage 4 wrote 269 integration tests and the defects that mattered
were found by six of them.

**Two lessons from Stage 4 that are cheap to keep:**

- A status code proves an invariant; only a message assertion proves the code
  path that produced it. A dead error-mapping branch survived three stages
  because every test asserted the status and none asserted the text.
- Verify a wire format against the live service before writing a client for
  it, never from memory.

**Renumbered 2026-09-12**, nine stages to eight: the old 6 and 7 merged, since
attendance is what makes a certificate eligible and the two were always built
together.

**Renumbered 2026-09-11**, from twelve stages to nine. No feature was dropped — the old
4+5, 6+7 and 10+11 are merged, because each pair is genuinely coupled (membership is
meaningless without clubs; registration without events) and three fewer design/plan/review
cycles is real time back. Earlier references in this document to "Stage 4", "Stage 10" and
so on predate this and mean the old numbering; the contents are what matter.

---

### Stage 1 completion note (2026-09-11)

Delivered on branch `stage-1-foundation`: 32 unit tests, 100 integration tests against a real PostgreSQL 18, all green. Every invariant in §5.2 exists as a partial unique index, `CHECK` constraint or trigger, each proven by a test that fails without it.

**Deviations from this spec, and why:**

- **Testcontainers and Docker Compose dropped** (§4.1, §12). The development machine has no Docker. Local integration tests run against a native Postgres 18 with a dedicated `majlis_test` database; CI uses a `postgres:18` service container.
- **`@nestjs/cli` is not used.** Version 12.0.0 is the only stable 12.x and it cannot run at all — it pins ESM-only `ora@9.4.1` while `@angular-devkit/schematics` `require()`s it in a cycle, so even `nest --version` dies on Node 22. `build` is `tsc -p tsconfig.build.json`; the dev loop is `node --watch -r @swc-node/register`, because `tsx`'s esbuild transform does not implement `emitDecoratorMetadata` and silently breaks Nest's constructor injection.
- **Prisma 7 removed `url` from the datasource block.** Connection strings live in `apps/api/prisma.config.ts`. Migrations use `DIRECT_URL`; the application uses the pooled `DATABASE_URL` through the mandatory driver adapter.
- **`zod` pins to 4.5.4, not 4.6.1.** pnpm 11 enforces a 24-hour minimum release age; 4.6.1 was too new. Standing rule: never pin a package published in the last 48 hours, and never add a `minimumReleaseAgeExclude` to bypass the check.
- **`nestjs-zod@5.5.0` does not declare NestJS 12 support.** A scoped `peerDependencyRules` override in `pnpm-workspace.yaml` permits it; `cleanupOpenApiDoc` replaces the removed `patchNestJsSwagger`.
- **The global route prefix carries a leading slash, and this is load-bearing.** `@nestjs/core`'s `registerNotFoundHandler` and `registerExceptionHandler` skip the normalisation `registerRouter` applies, so `'api/v1'` routes 404s and unhandled errors around every exception filter — silently. Guarded by `API_PREFIX` and a test.
- **`AttendanceRecord.registration` is `onDelete: Restrict`**, matching `Certificate`. Deleting a registration must not destroy the proof someone was in the room.
- **`db:seed` refuses to run** when `NODE_ENV=production`, or against any non-localhost database unless `ALLOW_REMOTE_SEED=yes`.
- **Log redaction targets what pino-http actually serialises** — `req.headers`, `req.query`, `res.getHeaders()`. Request bodies are never serialised, so body paths would be inert. **`req.url` still carries the raw query string and is not redacted: a known remaining exposure to close before Stage 3 puts invitation tokens in query strings.**

**Carried out of Stage 1:**

1. ✅ **An ESLint boundary rule banning `PrismaService` injection outside `src/prisma/`** — done 2026-09-11, ahead of Stage 2. `PrismaService` must stay injectable, so nothing else stops a service writing outside the ambient transaction, which would let an action commit while its audit row rolls back. Implemented as `@typescript-eslint/no-restricted-imports` scoped to `apps/api/src/**` with `apps/api/src/prisma/**` exempt — no new dependency. `allowTypeImports: true` is load-bearing and precise rather than lenient: Nest resolves constructor DI from `design:paramtypes`, so an injection is always a *value* import, and a type-only import cannot become one. `test/` and `prisma/seed.ts` are outside the rule's scope and reach the database directly on purpose. `HealthController` was the only violation in the repo and now reads through `host.tx`; with no transaction open that is the base client, so the query is unchanged. Guarded by `src/prisma/boundary.spec.ts`, which runs the ESLint API over fixtures and asserts in both directions — a lint rule fails silently, and a glob that matches nothing leaves the repo green while the boundary is wide open.
2. **`req.url` is logged unredacted, query string included.** `LOG_REDACT_PATHS` covers cookies, auth headers, `req.query.token`, `req.query.code` and `set-cookie`, but not the raw URL. Harmless while no endpoint takes a token in a query string; a live leak the moment Stage 4's team invitations put one in a link. `problem.filter.ts` also logs `{ err }` on 5xx, and Prisma validation errors embed the failing call's arguments. **Close before Stage 4.**
3. **CI has never actually run.** The workflow exists and its seven commands pass locally, but nothing has been pushed to a remote, so it is unexercised on a Linux runner. One green run is the only real evidence.
4. **A shared `test/factories.ts`.** `uniq()`, `aUser()` and `aClub()` are duplicated across the schema test files. Stage 2 needs the factories anyway.
5. **Register the Problem Details schemas in the OpenAPI document.** They are currently imported only as types, so the generated spec documents no error shape. Needs routes that declare error responses — Stage 2 supplies the first.
6. **Replace the seed's placeholder password hash** with real argon2id hashing when auth lands. `DEV_PASSWORD_HASH` is labelled `SEED-ONLY-NOT-A-REAL-HASH`, so the seeded accounts cannot currently be logged into.


### Stage 2 completion note (2026-09-11)

Delivered on branch `stage-2-auth`: 125 unit tests, 174 integration tests
against real PostgreSQL 18, all green. `/security-review` run — no HIGH findings.

**Deviations from this spec:**

- **Passport dropped** (§3 ledger, already amended). One strategy, a cookie-borne
  credential needing a custom extractor anyway, and a `validate()` that must hit the
  database regardless — a library wrapping forty lines.
- ~~Auth rate limiting pulled forward from Stage 12.~~ **Reverted 2026-09-11** at the
  owner's direction — `@nestjs/throttler` removed entirely. All rate limiting is Stage 12
  again. Login has no brute-force limit until then; argon2id's cost is the only brake.
- **The permission mechanism was built in full, not as a skeleton.** All three scope
  resolvers exist and are tested; only the matrix stays minimal (`user:list`,
  `user:suspend`, `club:edit`). Later stages add rows, not code.
- ~~Refresh rotation with family-wide reuse detection.~~ **Removed 2026-09-11** at the
  owner's direction as disproportionate for this system. The refresh token is now plain and
  revocable: logout and suspension revoke it, and it expires 30 days after login regardless
  of activity. Consequences accepted knowingly — a stolen refresh token works undetected
  until it expires or the session is revoked, and there is no sliding expiry. `replaced_by`
  is left in the schema unused; dropping it needs a migration and buys nothing.
  **Stage 3 no longer needs client-side refresh deduplication** — the two-tab race that
  rotation created is gone.
- **`ProblemExceptionFilter` maps Prisma `P2007` as well as `P2023` to 400.** Verified
  live: with `@prisma/adapter-pg`, a malformed UUID raises `P2007`, not the documented
  `P2023`.

**Open, carried into Stage 3+:**

1. **`trust proxy` is not set.** Behind the §9.2 Next.js rewrite, `req.ip` is the platform
   proxy for every caller, so `audit_log.ip` and `refresh_token.ip` record the hop rather
   than the client. Less urgent now that no rate limiting is IP-keyed, but **Stage 12 must
   set it before adding any**, and do not blindly use `trust proxy: true` — that makes
   `X-Forwarded-For` spoofable.
2. **`req.url` is logged unredacted**, and `problem.filter.ts` logs `{ err }` on 5xx.
   Close before Stage 4 puts invitation tokens in query strings.
3. **CI has never run.** Nothing pushed; the workflow is unexercised on a Linux runner.
4. **No password reset and no email verification anywhere in this spec.** A student who
   forgets their password has no recovery path. Decide before Stage 10 sets the
   notification patterns.
5. The generated OpenAPI document has no **success**-response schemas — adding the
   `@ApiResponse` error declarations displaced Nest's auto-generated defaults.

Carried items 4, 5 and 6 from Stage 1 are closed (shared test factories; Problem Details
in the OpenAPI document; real argon2id in the seed, so seeded accounts now log in).
### Stage 3 completion note (2026-09-12)

`apps/web` exists: Next.js 16 App Router, the warm-majlis visual identity, the shadcn
component layer re-pointed at our own tokens, and all three shells. 22 commits.

| | |
|---|---|
| Tests | 91 web unit, 95 API unit, 176 API integration, 50 Playwright/axe. All green |
| Verified | Contrast computed from the shipped token values, not asserted. Axe run over five surfaces in both themes at two viewports |

**Deviations, all recorded in the stage design's §10.** Four were approved up front: a thin
`fetch` client over `@majlis/contracts` instead of OpenAPI codegen; public discovery inside
the student shell rather than a `(public)` route group; `majlis_refresh` widened to `Path=/`;
and TanStack Query deferred to Stage 5. Two more were added during the final review: the
`/verify/{code}` page was not built, because no certificate exists to verify until Stage 7,
and the shell switcher sits in the header rather than at the top of the sidebar.

**The refresh cookie path was the only API change.** It passed a dedicated security review,
verdict safe to land. Without it `middleware.ts` cannot see the refresh cookie on a page
navigation, so a user holding 29 valid days is sent back to `/login` after 15 idle minutes.

**Carried forward, with the reasoning in the stage design and the branch history:**

- **Stage 9, blocking:** rename both cookies to the `__Host-` prefix. Widening the refresh
  cookie path removed the accidental protection that RFC 6265 path ordering gave against a
  sibling-subdomain shadowing attack. This is not the two-line change it looks like:
  `__Host-` requires the `Secure` attribute, and `secureCookies()` deliberately returns
  false in development, so adding the prefix as-is makes the browser reject both cookies
  and breaks the local dev loop. It needs a development-mode `Secure` decision first.
- **Stage 9:** an authorization refusal returns HTTP 200. Next 16 `forbidden()` gives a real
  403, which matters for logs and for anything caching in front of Vercel.
- **Stage 9:** no `helmet`, and no explicit `Cache-Control` on API responses.
- **Stage 5:** every page render costs a server round-trip to `/auth/me`, with no cache and
  no timeout, so a slow API stalls every navigation and `getSessionUser`s catch turns an API
  blip into a logout.
- **Stage 5, before the concurrency tests:** re-seeding now restores `capacity`, fixed on
  this branch. The same class of bug remains in the `department` and `club` upserts.
- **Stage 4:** the two authorization refusal strings are sentences rendered in a display
  `h1`, the only copy in the stage that breaks the title-not-sentence rule.

**A process note worth keeping.** Ten per-task reviews all passed while the stage was still
missing four spec requirements (sign out, the account menu, the shell switcher, and a link
between `/login` and `/signup`), because a per-task review compares code to its task and
never the task set to the spec. Only the whole-branch review caught it. That review also
caught a test that could not fail: `StatusBadge` asserted its two maps had equal key sets,
which TypeScript already guaranteed, while the component was missing 14 real enum values
and had invented two. Both defects originated in the plan, not in the implementations.

---
### Deviation: the student shell is no longer mobile-only (2026-09-12)

§3 and §9.1 fix the student shell as mobile-first with bottom tabs, and say nothing about
what it becomes on a desktop screen. The user overrode that directly: the site "looks bad on
desktop, its not only for phone", and asked for "both desktop and mobile design". The bottom
tabs survive unchanged below 1024px; above it the same five destinations become a persistent
side navigation, matching the officer and admin consoles, and content takes a capped measure
with multiple columns where the content earns them. One nav list feeds both presentations, so
they cannot offer different destinations, and the axe suite asserts that exactly one
"Sections" landmark exists at either width.

---
### Deviation: GET /events filters on the stored status, renders the due one (2026-09-12)

A list read renders each row's status as `dueStatus(row, now)`, a pure function, so the
badge and the register affordance agree with the detail page and with what the API will
accept. Writing on a list read would cost one transaction per row on the hottest read in
the product, so the stored value is left to the sweep and to single-event reads.

`?status=` still matches the **stored** value. A row whose due status has moved on but
which nobody has opened is matched by its old status and then rendered under its new one,
so a status-filtered page can show a row whose badge does not match the filter. Making the
filter agree would mean expressing `dueStatus` in SQL over four columns on every list
query. Accepted until a filtered list is something students actually use.

---
### Stage 5 completion note (2026-09-12)

Events and registration, planned in
[`2026-09-12-stage-5-events-registration.md`](../superpowers/plans/2026-09-12-stage-5-events-registration.md).
No new migration was needed for the invariants: every constraint §5.2 asks for already
existed from Stage 1. The one migration added is two cursor-pagination indexes.

| | |
|---|---|
| Tests | 320 API integration, 139 API unit, 52 contracts, 115 web unit, 134 Playwright/axe. All green |
| Verified | Capacity proven by removing the row lock and watching five concurrent requests oversell. 21 further mutations applied and each watched go red |

**Decisions taken in the plan rather than here:** field buckets for Marketing, CTO and
Operations; event creation staying with Lead, Vice and Admin because a Marketing officer
cannot set `startsAt`; `eligibilityRules` left null; list reads computing the due status
without writing; capacity raises promoting from the waitlist; and cancellation leaving
registration rows untouched.

**The plan was wrong in one place.** It put the poster upload at an unscoped
`POST /uploads/event-poster`, copied from the club-logo route. That works for clubs only
because `club:create` is Admin-only; `event:create` is held by club Leads, so an unscoped
route resolves no club scope and `PermissionsGuard` denies every real Lead their own club's
upload. It is club-scoped instead.

**Field-level permissions now exist** (`apps/api/src/auth/field-permissions.ts`), deferred
from Stage 4 and applied to clubs in the same change. A key absent from a bucket map is
refused, so a field added to a patch schema without a decision recorded there fails closed.
CTO holds nothing on a club, because no column on `Club` is technical.

**What the end-of-stage review earned, for the record**, since the process question of how
much review to run is live. Two reviewers, one security and one correctness, found fourteen
issues between them. Three were exploitable or spec-violating: the lifecycle sweep secret
was written to the request log in cleartext on every call including failed guesses, against
§11 which names that secret explicitly; `POST /events/:eventId/poster-upload-url` was gated
on `event:edit` while the field it writes is Marketing-only, so a CTO or Operations officer
could overwrite a live poster; and Admin overrides recorded no reason on six paths, three of
them predating this stage. The correctness reviewer found that `GET /events` never applied
`dueStatus` despite the plan requiring it, that `advance` replayed its whole walk under
concurrency (six concurrent reads produced twelve audit rows for a two-hop advance), and
that cancelling a place on a CANCELLED event promoted someone into it.

It also found a regression introduced by the override-reason fix itself: the server began
requiring `overrideReason` while no web screen sent one, so every Admin edit of an event or
a club 422'd. A Stage 4 screen, broken by a Stage 5 fix, with no test covering an Admin club
PATCH. That is the argument for the whole-branch review rather than per-task ones, again.

**Six mutations survived the suite**, one of which was a real gap: deleting the sweep's
`checkInOpensAt` candidate clause changed nothing, so an event whose check-in opens before
registration closes would never be swept to `ONGOING`.

**Carried forward:**

- **Stage 6:** re-registering over a `REMOVED` row answers 201 with that row, against §5.2.
  Latent until Stage 6 gives `REMOVED` a writer.
- **Stage 6 or 8:** there is no `error.tsx` anywhere in `apps/web`, and every client `load()`
  effect rejects unhandled on a non-404/403 API error, so a revoked refresh token mid-session
  leaves the screen on its skeleton forever. Visible in the e2e server log as
  `unhandledRejection: ProblemError`.
- **Stage 7 or 8:** `GET /events?q=` is a sequential scan. `title ILIKE '%…%'` cannot use a
  btree: 4.5ms over 4,000 events, linear, roughly 55ms at 50,000. The fix is `pg_trgm` plus a
  GIN index, which changes the deployment's database requirements and needs a decision.
- **Stage 7:** raising an event's capacity writes one audit row per promoted student in a
  loop inside one transaction. Bounded by the waitlist, so a 100 to 5,000 rise with 4,900
  waitlisted is ~4,900 round trips in one transaction. Batching means bypassing
  `AuditService.record`, which is the single funnel by design.
- **Stage 8:** the skip link's focus ring is `--color-primary`, low-contrast against the new
  deep-green auth ground. Needs a focus token that works on both light surfaces and dark
  grounds.
- **Stage 8:** an uploaded poster can be replaced but never cleared; no delete-object route
  exists. Same for club logos and banners.
- `TeamManager` and `MembersManager` still fetch `limit=100` and discard `nextCursor`.

**A toolchain landmine, now defused.** Commit `9f84214` made a comment-only edit to an
already-applied migration and its message claimed "no checksum concerns". That was wrong:
Prisma stores the file's hash, `migrate deploy` ignores it but `migrate dev` refuses to run
at all and offers to reset the database. Stage 5's first migration hit exactly that. Both
`majlis_dev` and `majlis_test` have been repaired. **Never edit an applied migration file,
including its comments.**

### Stage 6 completion note (2026-09-13)

Attendance and certificates, planned in
[`2026-09-12-stage-6-attendance-certificates.md`](../superpowers/plans/2026-09-12-stage-6-attendance-certificates.md).
**No migration at all.** Every constraint this stage rests on shipped in Stage 1:
`attendance_record_registration_id_key`, `certificate_one_active_per_registration`, and the
unique serial and verification codes.

| | |
|---|---|
| Tests | 371 API integration, 165 API unit, 60 contracts, 124 web unit, 160 Playwright/axe. All green |
| Verified | Double check-in proven by dropping `attendance_record_registration_id_key` and watching two rows appear. 41 further mutations applied and each watched go red |

**Decisions taken in the plan rather than here:** the HMAC token shape; no typed fallback
credential, because a camera failure falls through to manual check-in keyed by email; six
scan outcomes as a 200 with a `result` discriminant and only "not authorised" as a 403;
`NO_SHOW` written in the same transaction as the hop to `COMPLETED`; and issuance gated on
`endsAt` plus the correction window rather than on `COMPLETED`, since issuing at completion
would make §7.5's 48 hours for correcting attendance zero.

**The plan was wrong in one place.** It had the lifecycle sweep call `issueForEvent` per
swept row. That would have issued almost nothing: `sweep()` only selects events in
`PUBLISHED`, `REGISTRATION_CLOSED` and `ONGOING`, and an event cannot issue until 48 hours
after it reaches `COMPLETED`, so no row the sweep advances is ever issuable. Certificates
would only have gone out when somebody happened to open a completed event. `issueDue()`
selects on the real condition instead, and the sweep reports `certificatesIssued`.

**Certificates now live in their own private bucket.** `majlis-storage` is public, which is
right for logos, banners and posters, and wrong for a credential document: the object path
is a pure function of the certificate id, every holder of `registration:read` can list those
ids, and `/object/public/<path>` answered 200 with no cookie, making the ownership check on
`GET /certificates/{id}/pdf` decorative. Signing the URL does not fix that on its own; the
bucket has to refuse the unsigned path. `majlis-certificates` is private, PDFs are handed
out as 300-second signed URLs, and `pdfUrl` stores the object path as a render marker only.
**A second bucket is now part of the deployment's setup.**

**What the end-of-stage review earned.** Two reviewers, one security and one correctness,
found ten issues. The security reviewer found one: manual check-in resolved the submitted
address before the event gate, so an unknown address answered `NOT_REGISTERED` while a known
one reached the window check and answered `EVENT_NOT_OPEN`. Since every event is closed for
all but a few hours of its life, that was the ordinary behaviour of the route, and it made
the check-in screen an oracle for who holds a Majlis account, probeable with arbitrary
addresses by any club Operations officer. The code asserted the opposite in a comment
directly above the bug.

The correctness reviewer found the public-bucket exposure above, that `expected` counted
ex-waitlisters once an event completed so a perfectly attended event reported 30/40, that
`correct()` had no status guard and could resurrect a `CANCELLED` registration as
`CHECKED_IN` and make it certificate-eligible, and that an Admin correcting a `CERTIFIED`
event's attendance to absent left the certificate `ACTIVE` and publicly verifiable for
someone the system now recorded as absent.

**Two green tests were worthless, and the question that found them was "name the broken
implementation this would catch".** The `expected` test asserted the count while the event
was still `ONGOING`, which is before the transition that breaks it. The QR secret redaction
test fed a 32-character value that passes `min(32)`, so Zod raised no issue for that field
and the assertion that the secret was absent from the error had nothing to catch. Both have
been rewritten to discriminate.

**One review finding was a false positive**, and it is instructive: that every certificate
download would 500 because the bucket only allows `image/webp`. The reviewer read that from
[`2026-09-12-stage-4-clubs-team-membership-design.md`](2026-09-12-stage-4-clubs-team-membership-design.md)
§3.1, which says so. The live bucket accepts `application/pdf`. **The design doc is stale
and the live service is the authority.** Probe it rather than trusting a document.

**A Stage 5 defect fixed here.** `UserPicker` called `GET /users`, which is Admin-only,
from the event AssignPanel, `TeamManager` and `MembersManager`. A club Lead got a 403, the
rejection was unhandled, and the list rendered empty, so a Lead could not assign anybody.
That made this stage's `EventAssignment` path, the whole reason `attendance:scan` has an
event column, unreachable through the UI. `GET /users` stays Admin-only; a club-scoped
`GET /clubs/{id}/user-search?q=` behind a new `user:search` permission backs the pickers.

**`error.tsx` now exists**, closing the gap the Stage 5 handoff named first, but the five
boundaries alone would never have fired: a promise rejected inside a `load()` effect reaches
no React error boundary. `lib/use-async-error.ts` rethrows during render and is wired into
all 17 first-load effects, and `apiFetch` ends the session itself when a 401 survives the
refresh retry.

**Carried forward:**

- **Stage 7:** `/me/certificates` is ordered oldest-first, because cursor order is by id, so
  a student's newest document is last.
- **Stage 8:** `@react-pdf/renderer` and `react` are now API dependencies, and the API's
  `tsconfig` enables JSX for one file. Worth a look in the bundle-size pass.
- **Stage 8:** the em dash ban is respected in Stage 6 files but violated across code
  predating it. A single sweep, not a per-stage chore.

**A process trap, now understood.** A Playwright run against the `node --watch` API server
produced twelve failures that looked exactly like application bugs, including "Internal
Server Error" rendered on the sign-in form. The API had restarted six times mid-suite, the
Next rewrite got `ECONNREFUSED`, and the browser was shown Next's own 500. The API log
carried zero 500s on `/auth/login`; the evidence was in the *web* server's proxy log. Re-run
on a stable server: 160 passed, zero restarts. **Before trusting an e2e failure, check
whether the API restarted during the run.**

### Stage 7 completion note (2026-09-13)

Notifications and reporting, planned in
[`2026-09-13-stage-7-notifications-reporting.md`](../superpowers/plans/2026-09-13-stage-7-notifications-reporting.md).
**Two migrations**: `PasswordResetToken`, and `user.password_changed_at`.

| | |
|---|---|
| Tests | 432 API integration, 201 API unit, 72 contracts, 135 web unit, 195 Playwright/axe. All green |
| Verified | Every suite re-run by the orchestrator rather than taken on report, with the API restart count checked at zero during each Playwright run |

**Email delivery is not verified anywhere in this stage, and must not be claimed.** There is
no `RESEND_API_KEY`. With none set the factory resolves `SkippingChannel` and every
notification lands `SKIPPED`; `ResendChannel` is exercised only through template render unit
tests. The abstraction, the ten triggers, the failure handling and the inbox are all real and
tested. The sending is not.

**Decisions taken in the plan rather than here:** delivery as a sweep rather than
fire-and-forget, so a failed email can never roll back the action that caused it; the
material-change field set (`startsAt`, `endsAt`, `venue`, `onlineUrl`, `timezone`), so a
retitled event notifies nobody; `forgot-password` always answering 202; CSV exports capped at
10,000 rows; and club-scoped audit covering the club and its events only, because `AuditLog`
deliberately has no foreign keys to join through.

**The plan shipped a security hole and the implementer caught it.** It had the reset link
stored in the notification payload so the e2e could read it back. That undoes the entire
reason `PasswordResetToken` stores only a sha256: one read of `notification` would yield
working reset links for every pending request, and those rows outlive the token's own expiry.
Corrected mid-stage. The raw token now exists only in memory on the `forgotPassword` call
stack, and that one notification type delivers inline rather than through the sweep so
nothing persists between minting and sending. The web e2e lost its round trip as a result;
the API integration test covers it instead, where the raw token is legitimately in hand.

**A reset did not end live sessions.** The access token is a stateless 15-minute JWT, so
revoking refresh tokens left a stolen cookie working for up to another 15 minutes. A reset
exists precisely because the credential may already be compromised. `user.password_changed_at`
is now compared against the JWT `iat` in `SessionGuard`, floored to seconds with `<=` so a
token minted in the same second as the reset is treated as older. The deliberate cost is that
a user who resets and signs back in within one second is bounced once.

**What the end-of-stage review earned.** Security came back clean, with auditable negatives.
Correctness found seven, three of them real:

- **Every list in the product was oldest-first.** `cursorArgs` hardcoded `orderBy: { id: 'asc' }`
  and ids are uuid v7, so the inbox showed a student their oldest notifications with new ones
  stranded behind "Load more", the audit viewer opened on the oldest rows ever written, and
  the unread badge fetched the ten oldest unread and stuck. This was also the root cause of
  the `/me/certificates` ordering defect carried forward from Stage 6 as cosmetic. It was not
  cosmetic. `cursorArgs` now takes a direction, defaulting to `asc` so no existing caller
  changed.
- **A reissue told the holder their certificate was revoked and never that a replacement was
  issued.** During a name correction the inbox was not merely incomplete, it was misleading.
- **A signed-in visitor could not use a reset link at all.** `(auth)/layout.tsx` redirected
  anyone holding a session, so opening the mail on a laptop that is still signed in bounced to
  `/home`, the token expired unused, and no change-password screen exists anywhere else. That
  is the case a reset is most needed in. The layout is styling-only now and the bounce lives in
  the login and signup pages.

**A test asserted the opposite of its own comment**, claiming to prove a row "the product
itself produced, not one this file inserted" and then inserting the row by hand. And the
club-report fixture would have passed against two implementations the code's own constants
exist to prevent. Third stage running that "name the broken implementation this test would
catch" has found something real.

**An accessibility check passed because the fixture was small.** Two mobile axe scans on the
event editor went red in this stage against a screen byte-identical to master. Nothing
regressed: a table wide enough to overflow at phone width was keyboard-unreachable since
Stage 6, and Stage 6 passed only because its rosters were short enough not to overflow. Fixed
in `ui/table.tsx`. Worth carrying: a passing a11y scan is evidence about the data as much as
the markup.

**Carried forward:**

- **Stage 8:** `db:seed`'s guard is `status: { not: 'CANCELLED' }`, so a registration left at
  `NO_SHOW` by an earlier suite run is never restored. The documented "re-run `db:seed` to
  refresh the scan window" fixes the window and not the registration, and the attendance walk
  then fails in a way that looks like a product bug. It cost a session time already.
- **Stage 8:** `GET /clubs/{id}/audit` scans up to 500 of a club's event ids per page. The
  upgrade path is a `club_id` column on `AuditLog` written at record time.

### Stage 8 completion note (2026-09-15)

The last stage, and the only one shaped as audit-then-fix rather than build-then-review.
Two read-only audits ran over the whole codebase in parallel, one security and one
performance; one dispatch applied what they found; the README and handbook were written
last so they describe what shipped.

**Seven stages of per-branch review had never looked at the product as a whole, and it
showed.** The security audit's headline finding was that both club roster routes carried
no permission key at all. `GET /clubs/{id}/members` and `/team` handed every member's name
and email address to any signed-in user, which made the `user:search` permission added in
Stage 6 decorative: the rule existed precisely so that an address only reaches somebody who
already leads a club, and the roster handed it to everyone. Every previous review saw one
branch, and a route that is missing a decorator looks identical to one that does not need
it unless you are reading the permission matrix against the whole route table. Verified
live after the fix: the lead sees `userEmail` on a roster row, a plain student gets the
same row with the field absent.

**Every timestamp the product had ever written was four hours off.** The Prisma pg driver
adapter parses `timestamptz` as naive UTC, so a write shifted by the server's `TimeZone`
setting and a read shifted it back. Symmetric, so the application never noticed and no test
could have caught it. It matters because the shift is the *server's* offset: `Asia/Dubai`
on this machine, `UTC` on Supabase, so identical code stored different instants in
development and production. The connection now pins `options=-c timezone=UTC`. This is the
clearest example in the build of a defect that only a direct probe finds: the evidence was
writing `2026-06-15T12:00:00.000Z` through Prisma and reading `extract(epoch)` back as
`08:00:00Z`.

Also fixed: signed upload URLs bypassed the club status freeze and left no audit row, so an
officer of an archived club could replace its live logo through the one path with no gate;
logout revoked the refresh family but left the issued JWT working for up to fifteen more
minutes, which `password_changed_at` (now `sessions_invalidated_at`) had always been the
mechanism to prevent.

**Performance was measured, and three of six fixes did not buy what the audit predicted.**
That is the part worth carrying forward. The audit reasoned from the code and was right
about direction and wrong about magnitude more often than not:

- It predicted the bundle fix would remove 419.5 KB from every route. It removed 13 KB
  decoded, 3 KB gzip. The contract schemas did leave the universal chunk, but what
  dominates it is zod itself plus Radix, and zod is held by `problemDetailsSchema`, which
  `apiFetch` parses every error response with. Stubbing that out takes the universal route
  to 637.5 KB, so roughly **366 KB decoded sits behind removing runtime validation from the
  browser's error path**. That is a trust-boundary decision, not a performance one, and it
  was deliberately not taken.
- It predicted an `(entity_type, id DESC)` index would collapse the rare-entity-type audit
  query. It does not, because `(entity_type, entity_id)` already answers that case. The
  index buys the sort, not the scan.
- The `?upcoming=true` index and the `pg_trgm` GIN index are both only partly used: a
  common search term still plans identically at 8.4 ms. A rare term goes from 8.6 ms to
  0.119 ms, which is the case that was worth it.

The three that did land as predicted were large: the notification delivery sweep was a
parallel sequential scan of every notification ever written (37.4 ms to 0.019 ms at 400,000
rows), the `actorUserId` audit filter got *slower* the more selective it was because the
planner walked the primary key backwards (46.5 ms to 0.011 ms), and the scan path lost two
round trips end to end (257 ms to 223 ms through a proxy with a 5 ms per-packet delay).
`pg_trgm` is a database requirement from this stage on, which is in the handbook.

**One e2e was signing every other one out.** Eight failures appeared on the first full
Playwright run after this stage, six of which passed in isolation and one of which was
deterministic: the single test that signs out was doing so as the seeded student account
that twenty-seven other tests sign in as, and `sessions_invalidated_at` is account-wide. Any
of them mid-navigation when it landed bounced to `/login` and failed on a missing element,
which reads exactly like a product defect. Worth carrying: **a shared fixture account plus
one destructive test is a suite that fails at random**, and the failure never points at the
test that caused it. It also surfaced a comment that claimed the opposite of the behaviour,
asserting another device "renews itself on its next request"; the web middleware only
renews when the session cookie is *absent*, and the stamp leaves it present but rejected.
Signing out signs out every device. That is now stated rather than contradicted.

**What this stage did not do.** No rate limiting and no deployment, both dropped by the
product owner on 2026-09-13 and recorded in §14. No CSP, because the app uses inline styles
and a server-generated inline SVG and a wrong policy breaks the product silently. The club
audit keeps its 500-event cap rather than gaining a `club_id` column, which is a migration
plus a backfill of an append-only table and not a last-stage change.

**Known limits, stated plainly rather than left to be discovered:** CI has never run, so
eight stages of green suites are eight stages of green suites *on one Windows machine*.
Email delivery has never been verified against a real Resend key. Both Supabase buckets are
created by hand and nothing in the repository creates or verifies them, which makes a fresh
environment silently 500 on its first certificate download. Setting `RESEND_API_KEY` makes
`POST /auth/forgot-password` able to send mail to a caller-chosen address, unauthenticated
and unlimited, so it should be limited in the same change that turns email on.

---

## 14. Open items

- ~~The visual identity itself, palette, type ramp and component language, is deferred to Stage 3~~ Settled in Stage 3; the approved values live in [`2026-09-11-stage-3-shells-design.md`](2026-09-11-stage-3-shells-design.md) §2.
- The check-in/out and minimum-duration attendance policies are a later additive stage. `event.attendance_policy` is an enum with room to grow, and adding check-out is a nullable column plus a new branch in the eligibility function — no restructuring. **No unused columns are added now.**
- This spec covers nine stages and will therefore produce **one implementation plan per stage**, not a single monolithic plan. Stage 1's plan is written first; each subsequent stage is planned when the previous one is done, so later plans can absorb what earlier stages taught us.
- Vercel Hobby's non-commercial terms must be revisited before Majlis serves a paying customer.

### Rate limiting is dropped from the build (2026-09-13)

§11 called for rate limiting on login, signup, scan and `/verify/{code}`, deferred to the
final stage. **It is now dropped entirely**, by the product owner's decision, and Stage 8 is
security, optimisation and performance, the README and the handbook.

The options were laid out before the decision: the four routes §11 names, plus the six
unauthenticated routes Stages 6 and 7 added that it could not have anticipated, plus the two
shared-secret sweep endpoints. Recorded here so a later reader does not mistake the absence
for an oversight.

**The one consequence worth carrying:** `POST /auth/forgot-password` is unauthenticated and
sends mail to an address the caller chooses, and always answers 202, so nothing slows a
caller down. Unlimited, it can be pointed at any student's inbox and will burn the Resend
quota. It costs nothing while no `RESEND_API_KEY` is set, which is the state today. **Anyone
turning email on should limit that route in the same change**, and the handbook says so.

### Deployment is not part of Stage 8 (2026-09-13)

Vercel deployment, `vercel.json`, the production env inventory and CI are all deferred and
will be done with the product owner directly, not by an agent. Nothing in Stage 8 writes
deployment configuration.

This leaves **CI still never having run**, which remains the largest untested assumption in
the project: eight stages of green local suites on one Windows machine is not the same claim
as green on a clean Linux runner with a `postgres:18` service container. Path casing, line
endings and the Playwright browser install each break exactly once, on the first CI run.

It also leaves the **storage buckets created by hand**: `majlis-storage` (public) and
`majlis-certificates` (private, added in Stage 6). Nothing in the repository creates or
verifies them, so a fresh environment silently 500s on the first certificate download. The
handbook must carry this.

### The API deploys to Render, not Vercel (2026-09-15)

The original decision, from Stage 1, was "deployed entirely on Vercel". That was made before
anyone tried it, and the API cannot run there.

**NestJS 12 is ESM-only.** `@nestjs/core`, `@nestjs/common` and `@nestjs/config` all declare
`"type": "module"`. This app compiles to CommonJS, so every compiled file `require()`s an ES
module. Node supports that as of 22.12, unflagged, which is why every local run, the whole
test suite and eight stages of development never saw a problem. Vercel's function runtime
uses its own loader (the stack frames are `/opt/rust/nodejs.js`), and it rejects
`require(esm)` regardless of the Node version selected, so **every request failed with
`ERR_REQUIRE_ESM` before a route could run**. Setting `engines.node` to `22.x` did not change
it.

Two ways out were tried and rejected. Bundling the app to a single CommonJS file with esbuild
does produce a bundle, but a 20 MB one that dies on `createRequire(import.meta.url)`, because
ESM code flattened into CJS leaves `import.meta` undefined; repairing that means hand-patching
globals a framework expects. Migrating the API to ESM is the genuinely correct long-term fix,
since NestJS 12 is ESM and the app arguably should be, but it means `"type": "module"`,
`moduleResolution: nodenext`, `.js` extensions on every relative import across the whole
`src` tree, and regenerating the Prisma client as ESM. That is a real refactor and doing it
at the end of a project to satisfy one host is the wrong order.

So the API runs as a persistent Node process on Render, where `node dist/main.js` works
unchanged, and the web app stays on Vercel. `render.yaml` is committed.

**Node 22.12 is now a documented hard floor for this project**, which nothing had ever
stated. It is the single most load-bearing fact about running this codebase anywhere, and it
was invisible precisely because every machine that ever ran it happened to satisfy it.

Five other things had to be fixed before this was even visible, each hidden behind the
previous one: there was no serverless entry point at all, Vercel recompiled the TypeScript
with its own config and failed on a `Response` type, Supabase's direct database host is
IPv6-only and unreachable from a build machine, the runtime Node was too old, and a restored
build cache skipped `postinstall` so the Prisma client was never generated. The last two
fixes are kept because they are correct regardless of host: `prisma generate` belongs to the
build rather than to `postinstall`, and the Node floor belongs in `engines`.

### First-run admin bootstrap (2026-09-15)

A deployed Majlis had no reachable path to an admin account, and therefore none to a club,
since only an admin can create one. Nothing in the product writes `platformRole`:
`UsersController` exposes `/me`, `/users`, `/clubs/{id}/user-search` and
`/users/{id}/status`, and that last one changes `status`, never the role. The seed is
development-only. So the first Render deploy came up healthy, with a working database and an
empty `user` table, and stayed permanently unusable. Stages 1 to 8 never surfaced this
because every environment was seeded.

Added `GET /auth/bootstrap` (`{ needsAdmin }`) and `POST /auth/bootstrap`, both `@Public()`,
and a `/setup` screen. `/login` and `/signup` redirect to it while `needsAdmin`; it redirects
to `/login` once an admin exists, so it disappears after first use and no route brings it
back.

**The endpoint is deliberately unauthenticated and ungated.** Whoever reaches a deployment
that has no admin can claim the account, so it must be claimed immediately after a deploy. A
setup token held in an env var was offered and declined: it would have closed the window
entirely at the cost of one pasted secret. Recorded here because the trade is invisible in
the code, which simply looks like a public endpoint that creates an admin.

Two things make it safe within that trade. The guard reads the database rather than a flag the
endpoint sets, so an admin created by the seed or by hand closes it just as firmly. And it
serialises on `pg_advisory_xact_lock`, not on a row: the guard's whole premise is that no
admin row exists, and an empty result set locks nothing, so two concurrent requests would both
count zero and both insert. Verified by deleting the lock and watching two parallel requests
both answer 201.

`/setup` had to join `AUTH_ROUTES` in `apps/web/src/lib/routing.ts`. Middleware bounces an
anonymous visitor on an unknown path to `/login`, which now redirects to `/setup`, which
bounced back: `ERR_TOO_MANY_REDIRECTS`, and the only screen that can create an admin
unreachable for good. The same loop the file already warns about, in the one state no seeded
test can reach. Caught by walking the flow against an empty database, not by the suite.

The body reuses `signupBodySchema` rather than a second schema, so the admin is created under
the same password and email rules as any account, and the form takes a full name alongside
email and password because `User.fullName` is required and renders in the shell and on every
audit row. The audit row is written in the same transaction with a null actor: nobody was
signed in to do this, which is what `AuditLog.actorUserId` being nullable is for.

### The student shell loses two tabs, and CI is removed (2026-09-16)

Four changes to §3's "three app shells" decision and one to deployment, all by the product
owner. The shells themselves are unchanged; what moved is where the student reaches two of
them from.

**GitHub Actions is removed.** The workflow added on 2026-09-15 ran once and failed two jobs,
`Migrations match schema` and the e2e suite. Neither was triaged. Deployment is Render and
Vercel and both run their own build, so the workflow is deleted rather than fixed. This
restores the state the 2026-09-13 entry above describes: every suite has only ever run on one
Windows machine, and that remains this project's largest untested assumption. The two
failures are now unexplained rather than pending.

**`/me` becomes `/profile`, and the profile absorbs the account controls.** The whole route
segment moved, so `/profile/qr`, `/profile/notifications`, `/profile/registrations` and
`/profile/certificates` follow and nothing is left at `/me`. The API's `/me/*` endpoints are
untouched; only the web routes moved. The screen now opens with the viewer's identity and
carries the theme control, the shell switcher and sign-out, all three of which used to live
in the avatar's dropdown.

**The avatar is a link, not a menu, in all three shells.** A dropdown that was the only route
to a full screen made that screen read as a submenu, and put the theme switch two taps deep on
a phone. The consoles keep their header theme toggle, since a desktop operator flips it far
more often than they open `/profile`.

**The tab bar drops to four: Home, Clubs, Events, My QR.** The inbox moved to a bell beside
the avatar, at every width, so the phone tab bar and the desktop side nav still cannot drift
apart. A screen under `/profile` lights the avatar rather than a tab; `/profile/qr` and
`/profile/notifications` keep their own lit control instead, and `ProfileButton` derives that
from the pathname rather than taking a prop, so a new profile screen cannot forget to declare
itself.

**`sessionClubRole` gains `clubName`.** The switcher labelled each console by role alone, so
an officer of two clubs saw two rows both reading "Officer" with the club ID the only thing
telling them apart. The name now rides on every auth response beside `clubId` and `role`.

**The tab bar is a floating dock.** Chosen from four mocked directions by the product owner.
Inset from all three edges, rounded full, translucent over a blurred backdrop, with the active
destination in a filled `--primary` pill. It is positioned over the scroll area rather than
taking a row in the shell's grid, which makes `main`'s `pb-28` load-bearing: without it the
last row of every student list sits under the dock and cannot be reached. A gradient veil
fades the page into its own background behind the dock, because content read through glass is
noise rather than depth.

**The bell and the avatar are lit by a soft teal ground, not an outline.** The avatar's
previous lit state was `ring-2 ring-primary`, which is the same picture `:focus-visible`
draws: the current-page state and the keyboard state were indistinguishable. Both controls are
now round, both take `--primary-soft` when lit, and the avatar's fallback goes to `--primary`
with it, because initials on `--surface-2` against `--primary-soft` is barely a step and the
halo disappears.

**`DropdownMenu` is deleted.** It was the avatar menu's component and nothing else in the
product used it, so `apps/web/src/components/ui/dropdown-menu.tsx` went, along with the
`menu-in` / `menu-out` keyframes and the two `data-slot` rules in `globals.css` that only
ever drove it. `ui/label.tsx` went with it: a `git log -S` shows nothing ever imported it,
so it was shadcn scaffolding that never entered the product. `NavItem` also loses its
`trailing` slot, which existed for the unread badge that now lives on the header bell.
`radix-ui` stays: avatar, dialog, select and sheet all still use it.

### The admin console loses two screens, and archiving becomes reversible (2026-09-16)

Five changes, all by the product owner after walking the admin console. Three were reported
as bugs and only one of them was: the other two were screens that had never been built and a
CSS default nobody had looked at.

**Archiving a club is no longer terminal.** `club-status.ts`'s `ALLOWED` table gains
`ARCHIVED: ['ACTIVE', 'SUSPENDED']`, so every club status now reaches every other and
`assertTransition` asserts only that the transition is not a no-op. This reverses the rule the
table was built around. It was reported as "I set the status to archived and I cannot edit it
back", which was the domain working exactly as designed and the UI faithfully mirroring it:
`NEXT_STATUSES.ARCHIVED` was `[]`, so the control disappeared and the screen could not say
why. A one-way door reachable by a two-click dialog is a misclick away from a club nobody can
recover, and nothing about the archive is expensive to undo.

The table is kept rather than collapsed into `from !== to`, which is all it now asserts. A
future restriction is written in a table, and a predicate would have to be rebuilt into one
first. `assertAcceptsEdits` is untouched, so an archived club is still frozen for profile
edits, team changes and new activity: the route back is reactivate, then edit. The
`club-status.spec.ts` test that asserted the terminal rule is inverted rather than deleted,
and the no-op test now covers all three statuses, because with a fully connected table the
no-op guard is the only rule left for a test to catch.

**The Metrics screen is deleted.** Three platform totals and two bar charts that answered no
question an admin actually had. `/admin` redirected to it, so the redirect now points at
`/admin/users`, the first entry of `ADMIN_NAV`. The API's `/reports/overview` stays, as do
`BarChart` and `lib/chart.ts`: the officer console's own report renders the same charts, and
the a11y suite's inline-SVG coverage moved onto that screen rather than being lost.

**CSV exports are deleted outright, screen and API.** `exports.controller.ts`, `csv.ts` and
`csv.spec.ts` are gone, along with `EXPORT_ROW_CAP`, `EXPORT_CAP_NOTICE`, `isCapped` and
`eventExportQuerySchema` in the contracts, the four `*Rows` methods on `ReportingService`, and
the export half of `reporting.integration.test.ts`. This removes a Stage 7 deliverable and
**fifteen passing unit tests**, recorded here rather than left to be discovered in a diff. The
decision was explicit: the feature was not wanted, and dead endpoints behind a deleted screen
are worse than no endpoints. `/reports/overview` and `/clubs/:clubId/reports` are unaffected.

**The admin Users screen is built.** It was never implemented: `users/page.tsx` had been an
`EmptyState` placeholder since Stage 3 scaffolded the three shells, sitting next to a
`loading.tsx` that already rendered a five-column table skeleton. `GET /users` and
`PATCH /users/:id/status` had been finished and unreachable since Stage 2. The screen is a
table with search, a status filter, and suspend/reactivate behind a required reason.

`GET /users` gains `q` and `status`, mirroring `GET /clubs`. `q` spans `fullName` **and**
`email`: an admin chasing a support request holds one or the other, and a name-only match
answers "no such user" for every address pasted in. `mode: 'insensitive'` is load-bearing, not
cosmetic, because Postgres `LIKE` is case-sensitive and a capital letter would otherwise
return nothing. Both facts have a test built to fail against the narrower implementation: the
`q` test uses three rows so each half of the `OR` is the only thing that can satisfy it, and
the case test would pass every lowercase assertion without the flag.

The row for the signed-in admin shows "You" instead of an action. That is presentation only.
The API's own 422 on changing your own status is the protection, per spec 9.1.

**`OverviewManager` becomes `components/ClubProfileForm.tsx`, shared by both consoles.** The
admin club detail screen had no edit form at all, only status-change and appoint-Lead, which
is what "I cannot edit all info" meant. The officer console's overview already was that form,
carrying the `CLUB_FIELDS` rules and spec 6.1's override reason for an Admin holding no role
in the club, so it moved into `components/` rather than being written a second time. It is
keyed on `club.status` in the admin screen, because it gates editing on the status and would
otherwise stay live after the panel below it archived the club.

`name` and `slug` remain absent from `patchClubBodySchema`, so no one can rename a club. That
is unchanged and was flagged to the product owner as its own item.

**The status pill was stretching to the full column width.** `StatusBadge` is `inline-flex`,
and both sites rendered it as a direct child of a `flex flex-col`, whose `align-items`
defaults to `stretch`. `self-start` on both. The second site, the student club detail header,
renders only for a non-active club, which is why nobody had seen it.

### Admins can edit accounts, and a dialog stopped flying in from the corner (2026-09-17)

**`PATCH /users/{id}` is added, behind a new `user:edit` rule.** An admin can now change
another account's `fullName`, `email`, `avatarUrl` and `platformRole`, any subset in one call,
always with a required `reason`, always audited in the same transaction. The product owner
asked for all four explicitly after being shown what each one costs.

This reverses the note in the 2026-09-15 bootstrap entry that "nothing in the product writes
`platformRole`". It does now, and that is the whole reason the rest of this entry exists.

`user:edit` is `{ platform: ['ADMIN'] }` with no club half at any level. A club-scoped version
would let a Lead mint a platform admin out of a club role, which is the permission model
inverted rather than extended.

**Three guards, and only one of them is obvious.**

*Self-role.* An admin cannot change their own `platformRole` (422), mirroring the existing rule
on `/status`. They may still edit their own name and address through the same route, so the
guard is written against the role field rather than against the target id. There is a test for
each half: a rule written as "no self edits at all" passes the first and fails the second.

*Last admin.* Demoting the final admin leaves a platform with no route back, which is the
2026-09-15 bootstrap failure reached from the other direction: only an admin creates a club,
and `/auth/bootstrap` shuts as soon as the first admin exists. Sequentially this is already
unreachable, because the self-role guard keeps the caller an admin. **The hole is concurrent:**
two admins demoting each other both read two admins before either commits, and the platform
commits its way to zero. The count therefore runs under `pg_advisory_xact_lock`, not a row
lock: the question is about a count across the table, and two admins demoting each other lock
two different rows. `ADMIN_COUNT_LOCK_KEY` is deliberately a different key from
`BOOTSTRAP_LOCK_KEY`; the two guard the same invariant from opposite ends and must not block
each other. The test runs both calls through `Promise.all` and asserts exactly one wins, which
a guard written as a plain count outside a lock fails and every sequential test passes.

*Email is a credential.* Changing an address revokes that user's live refresh tokens, the same
reasoning suspension already revokes on the way down: an admin repointing the address somebody
signs in with must not leave a live 30-day token behind on the old one.

**Only the keys actually present are written,** and the web form sends only the fields that
changed. Spreading the parsed body into Prisma's `data` looks equivalent and is not: an absent
key arrives as `undefined`, which Prisma treats as no-change, but that is indistinguishable
from an explicit `null` on `avatarUrl`. Sending the unchanged fields anyway would also write a
`user.updated` audit row for an admin who opened the dialog and saved without typing, and take
the email column through a no-op update that still revoked the person's sessions.

**The audit row's before/after is an allow-list, not the row minus `passwordHash`.** An audit
row is read by a human in the console and outlives the account, so a new column on `User` is
invisible to it until somebody adds it to `AUDITED_FIELDS` on purpose. The action is
`user.role_changed` whenever the role moved and `user.updated` otherwise, so a privilege grant
is filterable rather than buried among name corrections.

**Dialogs were playing their entire entrance 224px up and to the left.** Reported as "I see
them first at top left and then they appear in middle of screen". `DialogContent` centres
itself with `-translate-x-1/2 -translate-y-1/2`, and **Tailwind v4 compiles those to the
individual `translate` property, not to `transform`** (verified by compiling the utilities:
`translate: var(--tw-translate-x) var(--tw-translate-y)`). The `dialog-in` keyframe also
carried `translate(-50%, -50%)` inside `transform`. The two properties compose rather than
override, so the box sat at -100% on both axes for the whole animation and snapped to the
middle the instant it ended and `transform` reverted to `none`.

The keyframes now animate the individual `scale` property and say nothing about position, so
the centring is the positioning code's business alone. The individual properties apply in the
order translate, rotate, scale, so `scale` grows the box about its own centre with the
centring untouched. Sheet is unaffected: it has no translate utility, and its keyframes own
`transform` outright.

The regression test samples the bounding box every 16ms **during** the animation rather than
after it, because a test that waits for the dialog to settle sees a perfectly centred dialog
either way. Proven by restoring the old keyframe and watching it report 224px.

### The security review of the account-edit route, and what it found (2026-09-17)

`/security-review` on `PATCH /users/{id}` before it landed. Two real defects, both in the new
code, both fixed with a test apiece. Recorded because neither is visible from reading the
guards on their own: each one is a guard that looks correct and is not.

**The self guards compared a uuid as a JavaScript string.** `actor.id === targetId`, where
`targetId` is a path parameter. Postgres compares `uuid` case-insensitively and Prisma hands
ids back lowercased, so `PATCH /users/3F2B…` with the caller's own id upper-cased read as a
different user to the guard and resolved to the caller's own row everywhere after it:
`UUID_SHAPE` carries `/i`, and `${id}::uuid` normalises. An admin could demote themselves, the
one thing the guard exists to prevent.

Fixed with an `isSelf` helper comparing lowercased, applied to **both** call sites. The one in
`updateStatus` predates this work and had the same hole; fixing only the new one would have
left the same bypass a route away.

**The last-admin guard counted admins who cannot sign in.**
`count({ where: { platformRole: 'ADMIN' } })` ignores `status`, and `SessionGuard` refuses
anyone whose status is not ACTIVE. So a suspended admin propped the count up while being
unable to administer anything: suspend the other admin, then demote yourself through the
case-variant id above, and the platform reaches zero usable admins.
`AuthService.adminExists` counts by role alone and so stays shut, leaving no recovery short of
database access. Now `ACTIVE_ADMIN`, and the same guard is applied to `updateStatus`, because
suspending the last active admin reaches the identical end state.

**Both last-admin guards are unreachable sequentially**, which is why the first tests written
for them were wrong and were rewritten. The caller is themselves an active admin, so any
single demotion or suspension leaves at least one. The hole is concurrent: two admins acting
on each other both read two before either commits. Both tests therefore drive the pair through
`Promise.all` and assert exactly one succeeds. A guard written as a plain count outside the
advisory lock passes every sequential test and fails these.

**An email change ended the refresh tokens but not the live access token.** The first version
revoked `refreshToken` rows, which stops a new access token being minted but leaves the one
already in the browser valid for the rest of its 15 minutes. `sessionsInvalidatedAt` is the
field `SessionGuard` compares each request's `iat` against, and is what password reset and
logout already use. Now stamped in the same transaction.

**The review also cleared, explicitly:** unknown-key smuggling into `data: fields` (the global
`ZodValidationPipe` replaces the body with the parsed object, and `status` and `passwordHash`
are stripped), route ordering between `/users/:id` and `/users/:id/status`, SQL injection in
the two new raw statements (both Prisma tagged templates with bound parameters), the
`pickAudited` allow-list, and `test/db.ts`'s refuse-to-truncate-a-non-test-database guard,
which still holds on every branch after the change below.

### The integration suite could not run at all (2026-09-17)

Unrelated to the above and found while trying to verify it. `test/global-setup.ts` ran
`prisma migrate deploy` with `DIRECT_URL` set to a URL derived from `DATABASE_URL`, which on
Supabase is the **pooled** `:6543` endpoint. `prisma.config.ts` has carried the warning since
Stage 1: migrations cannot run through pgBouncer. They do not fail there, they hang, with no
error and no timeout, so the whole suite sat in setup forever and the test database was left
with zero tables.

`test/db.ts` gains `testDirectDatabaseUrl()`, which derives from `DIRECT_URL` before falling
back to `DATABASE_URL`, and `global-setup.ts` uses it for the migrate step only. The client the
tests themselves run on stays pooled, which is what the app uses in production. Both functions
route every branch through the same `assertTestDb`, so the guard that refuses to TRUNCATE
anything not named `majlis_test` is unchanged.

This is very likely the "Migrations match schema" CI failure recorded as untriaged in the
2026-09-16 entry.

**A caution for whoever runs these next:** two integration runs against the one test database
deadlock each other. `truncateAll` takes ACCESS EXCLUSIVE on every table while the other run
holds row locks, and the losing side reports `40P01 deadlock detected` from `beforeEach`, after
which every assertion in that file fails on stale data. A full-suite result collected while a
single file was being re-run alongside it showed 63 spurious failures. Run one at a time.

### A repo-wide cleanup pass (2026-09-19)

No stage. An over-engineering audit of the whole tree, applied. Recorded here because
three of the findings changed what the suites prove, not just how much code there is.

**The contrast suite was validating a copy.** `apps/web/src/styles/tokens.ts` held a
second set of all 25 colours, imported by nothing but `tokens.contrast.test.ts`, while
the values the browser loads live in `globals.css`. Editing a hex in the stylesheet left
all 52 assertions green. The test parses `globals.css` now and `tokens.ts` is deleted.
Two bugs fell out of doing it, both of which had been passing: `.dark` first occurs
inside `@custom-variant dark (&:where(.dark, .dark *))` on line 3, so a plain `indexOf`
walked to the `:root` brace and **the dark palette had never been checked at all**; and
`it.each` with array rows interpolates `%s` positionally, so titles read "ink3 on bg
meets #7C6F62:1". Proven to discriminate before being trusted: `--ink-3` set to #AAAAAA
fails two pairs, `--mute-fg` deleted from `.dark` fails the file.

**`consistent-type-imports` was suppressed 86 times in `apps/api/src`.** Nest resolves
constructor DI from `design:paramtypes`, so an injected provider must be a value import;
the `import type` the rule asks for emits `Object` and breaks injection at runtime with
no type error and no failing test. A rule that is wrong at every call site is not a rule.
Turned off for `apps/api/src/**` only — `test/` and `prisma/seed.ts` have no DI and keep
it, as do web and contracts.

**`@RequirePermission` emits its own 403.** The guard refuses every route carrying it
with one message, and the matching `@ApiResponse` was hand-written identically beside all
41 call sites. Folded in with `applyDecorators`. Two tests on the generated document, in
opposite directions: `/audit` must carry the 403 with a resolved Problem Details schema,
and `GET /me/invitations`, self-scoped by `actor.id`, must not.

Also cut: `apiText` and two comments describing the `text/csv` exports deleted on
2026-09-17 (`text/csv` now appears nowhere in the repository); `sonner`, whose `<Toaster />`
was mounted in the root layout with `toast()` never called once; four unused contract
exports (`meSchema`, `AttendanceRow`, `SessionClubRole`, `OverrideBody`, all four schemas
retained); and 17 `String(query.limit)` call sites, `qs` having been widened to take
numbers and booleans.

**`@majlis/contracts` was resolving `@types/node` by accident.** Removing the root
`@types/pg`, which existed only for a `node -e` one-liner that is never typechecked, broke
the contracts build: it needs the `URL` global under `lib: ["ES2023"]` and had been getting
it through that hoist. Declared explicitly. This is precisely the class of thing the
never-run CI would have caught on its first clean install.

**One optimisation, and two deliberately not taken.** `PermissionsGuard.loadFacts` awaited
`resolveEventFacts` then `resolveEventClubFacts` in sequence on every event-scoped request,
including the scan path §7.5 gives a latency requirement. They read different tables and
neither feeds the other, so they run concurrently now. The same shape in
`EventsService.toDetail` and `AuthService.issueSession` is left alone: both sit inside
`host.run`, where concurrent calls would queue on one transaction connection rather than
taking two from the pool.

`handoff.md` is reconciled and deleted, per the read order in `CLAUDE.md`. Its three
local-development traps — reseed before believing a timestamp failure, restart `next dev`
between full Playwright runs, read the web proxy log rather than the API log — had no
permanent home and are now in the handbook under "When a test looks broken", with the
integration deadlock and the destructive-test rule beside them. `docs/NEXT-AGENT-PROMPT.md`,
a prompt to build Stage 6, is deleted.

**Open, and deliberately not decided here:** `GET /reports/overview` has no web consumer.
It is exercised only by `reporting.integration.test.ts`. The 2026-09-16 entry above kept it
on purpose when `/admin/metrics` went, but that same entry argues that "dead endpoints behind
a deleted screen are worse than no endpoints". It is one or the other and wants an owner's
decision, not an agent's.
