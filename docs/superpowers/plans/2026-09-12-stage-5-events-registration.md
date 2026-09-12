# Stage 5 — Events & registration

Branch `stage-5-events-registration`. Five tasks, two dispatches (1-3 API, 4-5 web),
one combined code and security review at the end.

No migration. Every invariant this stage needs already exists in
`20260910203148_events`: `event_capacity_bounds`, `event_time_window`,
`event_registration_window`, `event_check_in_window`, `event_club_id_slug_key`
and the `event_registration_one_open_per_user` partial unique index.
`PermissionsGuard` already resolves `scope: 'event'` and, for an event, its
club's roles too.

## Decisions taken here

**Field-level edit permissions** are a second pure-data map beside
`PERMISSIONS`, in `apps/api/src/auth/field-permissions.ts`. Route-level
permission decides *may you touch this resource at all*; the field map decides
*which keys of the patch body*. Both are re-derived per request from
`ActorFacts`; ADMIN passes the field gate (§6.1 reads "override").

| Bucket | Event fields |
|---|---|
| Marketing | `title` `summary` `description` `eventType` `audience` `posterUploaded` |
| CTO | `onlineUrl` `timezone` `attendancePolicy` `certificateEnabled` `certificateTitle` `certificateSignatory` |
| Operations | `venue` `capacity` `waitlistEnabled` `checkInOpensAt` `checkInClosesAt` |
| Lead / Vice only | `slug` `startsAt` `endsAt` `registrationOpensAt` `registrationClosesAt` `requiresClubMembership` |

Lead and Vice hold every field. Clubs get the same mechanism: Marketing holds
`description` `category` `logoUploaded` `bannerUploaded`; CTO holds nothing on
a club, because no field on `Club` is technical, so `club:edit` gains MARKETING
and not CTO.

**Event creation is Lead, Vice and Admin only.** §6.1 merges create, edit and
publish into one row with per-column field qualifiers, but a Marketing officer
cannot create an event without setting `startsAt`, which is not theirs. Field
buckets govern editing; creation needs the whole object.

**`eligibilityRules` stays null.** §7.4 names department and year rules, but
`User` carries neither field and no invitation-code entity exists. Eligibility
in this stage is `requiresClubMembership` plus account and club status. Recorded
in §14 as needing a `User` field first.

**Lazy advance writes on single reads and actions, not on list reads.**
`GET /events` renders `dueStatus` as a pure function without writing; the sweep
endpoint persists in bulk. Advancing every row of a page would make a list read
N transactions.

**Raising capacity promotes from the waitlist** in the same transaction, through
the same path as cancellation. Lowering it below `confirmedCount` is refused.

**Cancelling an event leaves registration rows untouched.** Event status is the
source of truth and every gate reads it.

**Registering twice is idempotent**, per §8: an existing open registration is
returned unchanged rather than 409'd. 409 is reserved for the full-and-no-waitlist
case in §7.4 step 5.

---

## Task 1 — Contracts, field permissions, event status machine

Pure code and pure data. No I/O.

**Files**

- `packages/contracts/src/events/index.ts` (+ `index.test.ts`) — `eventStatusSchema`,
  `eventResponsibilitySchema`, `registrationStatusSchema`, `createEventBodySchema`,
  `patchEventBodySchema`, `cancelEventBodySchema`, `assignResponsibilityBodySchema`,
  `registerBodySchema` (admin override: `userId`, `overrideReason`),
  `eventSummarySchema` / `eventDetailSchema` / `eventPageSchema`,
  `registrationSchema` / `registrationPageSchema`, `eventListQuerySchema`.
  Barrel export from `packages/contracts/src/index.ts`.
- `packages/contracts/src/clubs/index.ts` — add `'event-poster'` to
  `imageKindSchema` and `IMAGE_KINDS` (cap 512 KB, box 1600x900, not square).
- `apps/api/src/storage/image-kinds.ts` — add `'event-poster': { folder: 'events', file: 'poster.webp' }`.
- `apps/api/src/auth/permissions.ts` — six rows: `event:create` (ADMIN, LEAD,
  VICE_LEAD), `event:edit` (ADMIN + all five club roles), `event:publish` (ADMIN,
  LEAD, VICE_LEAD), `event:cancel` (ADMIN, LEAD), `event:assign` (ADMIN, LEAD,
  VICE_LEAD), `registration:read` (ADMIN, club LEAD/VICE_LEAD, event
  EVENT_LEAD/OPERATIONS). `club:edit` gains MARKETING.
  `registration:read` deliberately grants club Operations nothing directly: §6.1
  gives that column "✔ for assigned event", which is an `EventAssignment`, and
  Marketing and CTO are excluded outright.
- `apps/api/src/auth/field-permissions.ts` (+ `.spec.ts`) — `CLUB_FIELDS`,
  `EVENT_FIELDS`, and `assertFieldsAllowed(body, map, facts)` throwing
  `ForbiddenError` naming the first refused field.
- `apps/api/src/events/event-status.ts` (+ `.spec.ts`) — `CHAIN` (the linear
  DRAFT → PUBLISHED → REGISTRATION_CLOSED → ONGOING → COMPLETED → CERTIFIED
  order), `assertTransition(from, to)` allowing one step along the chain or
  anything → CANCELLED, and `dueStatus(event, now)`, evaluated newest boundary
  first: past `checkInClosesAt` → COMPLETED, at or past `checkInOpensAt` →
  ONGOING, at or past `registrationClosesAt` → REGISTRATION_CLOSED, else
  PUBLISHED. DRAFT, CANCELLED and CERTIFIED are never due-advanced.
- `apps/api/src/clubs/clubs.service.ts` — `update` calls `assertFieldsAllowed`
  with the actor's club roles before building `data`.

**Invariants proven:** one allowed and one refused role per new permission; the
club Marketing officer refused on `membershipPolicy` and allowed on
`description`; every event transition that must be refused.

## Task 2 — Events API

**Files:** `apps/api/src/events/events.module.ts`, `events.service.ts`,
`events.controller.ts`, `event-lifecycle.service.ts`, `assignments.service.ts`,
`lifecycle-sweep.controller.ts`; `apps/api/src/config/env.schema.ts` gains
`LIFECYCLE_SWEEP_SECRET`.

**Routes**

| | |
|---|---|
| `POST /uploads/event-poster` | mints the event id, same shape as `POST /uploads/club-logo` |
| `POST /clubs/:clubId/events` | `event:create`, club scope; club must be ACTIVE |
| `GET /events` | cursor, filters `clubId` `status` `q` `upcoming`; DRAFT hidden from non-team |
| `GET /events/:eventId` | advances first, then reads |
| `PATCH /events/:eventId` | `event:edit` + field gate |
| `POST /events/:eventId/poster-upload-url` | `event:edit` |
| `POST /events/:eventId/publish` | `event:publish`; club must be ACTIVE |
| `POST /events/:eventId/cancel` | `event:cancel`; reason required |
| `GET/POST /events/:eventId/assignments` | `event:assign` |
| `DELETE /events/:eventId/assignments/:assignmentId` | nested, and loaded `where: { id, eventId }` |
| `POST /internal/lifecycle-sweep` | `@Public()`, timing-safe shared-secret header |

`EventLifecycleService.advance(eventId)` runs in `host.run`, walks the chain one
status at a time toward `dueStatus`, writes an audit row per hop, and is a no-op
when already current. `capacity` below `confirmedCount` is refused by the service
with its own message before the CHECK constraint would fire.

**Invariants proven:** refused transitions (publishing a cancelled event,
publishing from a suspended club, cancelling a certified event); the sweep
endpoint refusing a wrong secret; `advance` idempotent; capacity reduction
refused.

## Task 3 — Registration API

**Files:** `apps/api/src/events/registrations.service.ts`,
`registrations.controller.ts`, `waitlist.ts`.

**Routes:** `POST /events/:eventId/registrations` ·
`DELETE /events/:eventId/registrations/me` · `GET /events/:eventId/registrations`
(`registration:read`, cursor) · `GET /me/registrations` (cursor).

`register` is one transaction: `SELECT … FOR UPDATE` on the event row via
`$queryRaw`, re-check status, window and eligibility, then confirm-or-waitlist,
maintain `confirmedCount`, audit, commit. An existing open registration short
-circuits to a returned row. A `P2002` on
`event_registration_one_open_per_user` re-reads and returns the same way.

`cancel` sets CANCELLED, decrements the counter and calls
`promoteFromWaitlist(eventId, 1)` in the same transaction:
`FOR UPDATE SKIP LOCKED` over `ORDER BY waitlist_position`, promote to CONFIRMED,
set `promotedAt`, increment the counter. `PATCH /events/:eventId` raising
capacity calls the same helper with the new headroom.

Admin override registers another user with `overrideReason`, skipping only the
eligibility check, never the capacity lock, and writes an audit row carrying the
reason.

**Invariants proven:** the capacity guarantee under real concurrent requests,
proven by removing the row lock and watching it oversell; waitlist ordering and
transactional promotion; the registration window's open and close boundaries;
`registration:read` allowed for Lead and refused for Marketing.

## Task 4 — Student web

`apps/web/src/lib/events.ts` (client), `app/(student)/events/EventBrowser.tsx`,
`app/(student)/events/[eventId]/EventDetail.tsx` + `RegisterControl.tsx`,
`app/(student)/me/registrations/RegistrationsManager.tsx`. Client Components;
`lib/api.ts` fetches a relative path. Every Radix `SelectTrigger` carries its own
`aria-label`. Axe coverage extended to the new routes, including a full event so
the disabled register control is always scanned.

## Task 5 — Officer and admin web

`app/(club)/manage/[clubId]/events/EventsManager.tsx` and
`[eventId]/EventEditor.tsx` (create, edit with inputs disabled per the viewer's
field bucket, publish, cancel, assignments, roster),
`app/(admin)/admin/events/EventsOverview.tsx` (cross-club list, override
registration). Field gating in the UI is presentation; the server is the
protection.
