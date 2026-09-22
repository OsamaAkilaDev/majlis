# Stage 9: the app shell, restructured

**Status:** design approved 2026-09-22. Supersedes [`2026-09-10-majlis-design.md`](2026-09-10-majlis-design.md) §9.1.

## 1. Why

Three defects, all of them structural rather than cosmetic.

1. **`/home` is a stub.** It renders `<EmptyState title="Nothing here yet" />` and nothing
   else, yet it holds the first tab in the dock and is where `landingFor` sends every
   plain student. The most reachable screen in the product is empty.

2. **Clubs and Events are directories, not the viewer's.** Both open on a paginated list
   of everything, filtered by department or club. A student who belongs to three clubs
   and holds four registrations sees none of that first. The viewer's own relationship to
   the product, which is the only thing they opened the app for, is two taps away on a
   third screen.

3. **A club officer is thrown out of the application to do their job.** Holding a role in
   a club routes them to `/manage/[clubId]`, a seven-tab desktop console with tables and a
   sidebar. It is the right shape for an Admin looking across the university and the wrong
   shape for a student who runs the robotics club from a phone. Worse, `landingFor` makes
   it their *landing page*: an officer who is also a student lands in a console and has to
   navigate back out to the product.

## 2. The decisions

### 2.1 Two shells for people, not three

Spec §3 settled on "three app shells: student, club officer, admin". The club officer
shell is withdrawn. There are two: **the application** and **the admin dashboard**.

A club is not a workplace a student commutes to. It is an object inside the application
they already use, and the powers they hold over it are affordances on that object. A Lead
editing their club's description is doing the same *kind* of thing as a student
registering for an event: acting on a screen they were already looking at.

The admin dashboard stays exactly as it is, `/manage/[clubId]` included. An Admin looks
across every club in the university, needs tables, and works at a desk. That is a
genuinely different job and it keeps its own shape.

### 2.2 Officer powers appear on the object they act on

No screen exists solely because someone holds a permission. Every officer capability
attaches to the club or the event it concerns:

- Editing a club, its members, its team and its reports hang off the club page.
- Editing, publishing, cancelling an event, reading its roster and scanning into it hang
  off the event page.

A viewer without the permission sees a page with one fewer control on it. Not a different
page.

### 2.3 The officer surface is a sheet, not a tab strip

The club page carries **two** tabs for every viewer, Events and About, plus one `Manage`
button that appears only for a viewer holding at least one club-scoped permission. It
opens a sheet of rows, each pushing a full screen.

This is decided by the permission matrix, not by taste. The set of sections an officer can
reach is not one list, it is five:

| Role | Sections |
|---|---|
| `LEAD` | Edit club, Members, Team, Reports |
| `VICE_LEAD` | Edit club, Members, Reports |
| `OPERATIONS` | Members |
| `MARKETING` | Edit club |
| `CTO` | none |

A tab strip is a fixed structural element; one that is two tabs for a student, three for a
Marketing officer and six for a Lead reads as several different pages, and at 390 px the
Lead's version does not fit. A list of rows is naturally one or four long, and the club
page stays byte-identical for everyone until the button appears.

**Certificates is not on this list.** `certificate:manage` is `{ platform: ['ADMIN'] }`
with no club role at all, deliberately, so that a Lead cannot issue their own club's
certificates and an issued certificate stays an institutional record. A club officer's
only certificate-shaped right is reading an event's issued list under `registration:read`,
which belongs on the event.

### 2.4 Editing is a destination, not a mode

`ClubProfile` today is the student club page with every writable field quietly live. It
moves to `/clubs/[slug]/edit` unchanged. The club page a Lead opens is the page a member
opens; pressing Edit is what turns the fields into controls.

The same rule gives events `/events/[eventId]/edit` and `/clubs/[slug]/events/new`, the
latter being `EventsManager`'s create panel moved. Event creation is twenty-one fields and
four window rules; it is a screen, not a sheet.

`EventEditor` does not move, it **divides**. Its 576 lines already hold four things: the
form, the assignment roster, the registration roster and the attendance corrections. The
split runs along the permission seam. Form, poster, publish, cancel and assignments go to
`/edit`, because `event:edit`, `event:publish`, `event:cancel` and `event:assign` are all
held by the same people. Roster and corrections go to `/attendees`, because
`registration:read` admits an `EVENT_LEAD` or `OPERATIONS` assignee who must reach the
roster and nothing else. Assignments deliberately stay on the `/edit` side: putting them
beside the roster would hand the person who was just assigned the control that assigns
people.

### 2.5 Check-in is scoped to one event

`ScanSession` currently takes a `clubId` and opens on a picker: the operator chooses which
event they are scanning into before the camera starts. That picker exists only because the
scanner was reached from a club console. Reached from the event, the event is already
known, and the picker and its page-size fetch are deleted.

This also matches where the right comes from. `attendance:scan` admits
`event: ['EVENT_LEAD', 'OPERATIONS']`, so an `EventAssignment` grants scanning for **one**
event without making anyone a standing officer (spec §5.1). A club-wide scanner screen
could never express that; an event-scoped one expresses nothing else.

### 2.6 Management pages are addressed by slug

Spec §9.1 put management under `/manage/[clubId]` because `/clubs/[clubId]` would collide
with public discovery at `/clubs/[slug]`. There is no collision once the officer sections
live *beneath* the club page rather than beside it, and club slugs are immutable
(`patchClubBodySchema` has no `slug` key, unlike the event equivalent). Officer routes are
therefore `/clubs/[slug]/members`, `/clubs/[slug]/team` and so on.

### 2.7 The viewer's own data comes first, discovery is a destination

Events reads Registered, then From your clubs, then Past. Clubs reads Your clubs, then
Requested. Browsing everything is a separate route behind a search control in the header,
`/events/discover` and `/clubs/discover`, which are the existing `EventBrowser` and
`ClubBrowser` moved without change.

Past means **events the viewer registered for that have since ended**. Not their clubs'
back catalogue. It is the viewer's own history, and it is where a certificate is found.

## 3. Routes

**Removed:** `(student)/home`.

**Admin-only:** `/manage/[clubId]` and everything under it. The layout's check narrows
from `holdsRole || isAdmin` to `isAdmin`, and an officer arriving there is **redirected**
to `/clubs/[slug]`, never shown a panel inside a rendered page (spec §9.1). Its rail stops
branching on `platformRole` and is always `ADMIN_NAV`.

| Route | Content | Gate |
|---|---|---|
| `/events` | Registered, From your clubs, Past | signed in |
| `/events/discover` | `EventBrowser`, moved | signed in |
| `/events/[eventId]` | event, plus officer actions | signed in |
| `/events/[eventId]/edit` | the form half of `EventEditor`, plus assignments | `event:edit` |
| `/events/[eventId]/attendees` | the roster half of `EventEditor` | `registration:read` |
| `/events/[eventId]/check-in` | `ScanSession`, minus its picker | `attendance:scan` |
| `/clubs` | Your clubs, Requested | signed in |
| `/clubs/discover` | `ClubBrowser`, moved | signed in |
| `/clubs/[slug]` | club, plus the Manage button | signed in |
| `/clubs/[slug]/about` | unchanged | signed in |
| `/clubs/[slug]/edit` | `ClubProfile`, moved | `club:edit` |
| `/clubs/[slug]/members` | `MembersManager`, moved | `membership:decide` |
| `/clubs/[slug]/team` | `TeamManager`, moved | `club:team-manage` |
| `/clubs/[slug]/reports` | `ClubReports`, moved | `report:read` |
| `/clubs/[slug]/events/new` | `EventsManager`'s create panel | `event:create` |

Every gate is re-derived server-side from the database on each request. A slug or an ID in
a URL is a claim, never a permission (spec §11).

`EventsManager` is the only component that does not survive the move: its list becomes the
club page's Events tab and its create panel becomes the `new` route.

## 4. Navigation

- `STUDENT_TABS` becomes `/events`, `/clubs`, `/profile/qr`. `TabBar` goes to
  `grid-cols-3` and its travelling pill to `w-[calc((100%-0.75rem)/3)]`. The `/4` in that
  expression is load-bearing and is not a search-and-replace away from correct.
- `landingFor()` returns `/admin` for an Admin and `/events` for everyone else. An officer
  no longer lands in a console.
- `shellDestinations()` drops its per-club entries and its Home entry. An Admin gets one
  destination; everyone else gets none and the profile screen's section disappears. Clubs
  a viewer runs are reached from the Clubs tab, where they already sit at the top with a
  role chip.
- Both `error.tsx` files point home at `/events`.

## 5. Contract changes

Four, and nothing else. Every members, team, reports, roster, scan and correction
endpoint is already club- or event-scoped and already enforces the right permission.

- **`eventListQuerySchema.fromMyClubs: boolean`**: events from clubs where the caller
  holds an `ACTIVE` membership, excluding any the caller already holds a non-cancelled
  registration for. Orthogonal to `upcoming`, which it does not imply: the Events screen
  sends both. The exclusion is server-side deliberately: de-duplicating against the
  Registered section on the client is correct for the first page and wrong for every page
  after it.
- **`/me/registrations?past=boolean`**: splits on `event.endsAt`, the same predicate
  `upcoming` already uses on `/events`, which has the `(ends_at, id)` index behind it.
  `GET /me/registrations` currently accepts `CursorPageQueryDto` and nothing more, so this
  needs its own query DTO.
- **`clubDetailSchema.pendingMemberCount: number | null`**: the count on the Manage
  button. `null`, never `0`, for a viewer without `membership:decide`: absence of
  permission and absence of requests are different facts and a zero conflates them.
- **`eventSummarySchema.clubSlug: string`**: an event carries its club's name and logo
  but no slug, so the club line on an event page cannot be a link and
  `EventDetail.tsx` says so in a comment. Now that the club page is where a Lead does
  their work, an event is the commonest way to arrive at one, and a dead end there is the
  wrong answer. Its absence is the only reason that comment exists; the comment goes with
  it.

**Removed:** `clubDetailSchema.upcoming`, `clubDetailSchema.past` and the
`CLUB_EVENT_PREVIEW` constant. The club page's Events tab paginates `/events?clubId=`,
which is role-aware and therefore shows an officer their drafts, where the bounded preview
could not. `eventsRun` stays; the stats row reads it. The club page's server component
fetches the club and the first page of events in one `Promise.all`, so this costs no
round-trip latency.

## 6. Permission mirroring on the client

A new `apps/web/src/lib/club-sections.ts` derives the sheet's rows from `viewerClubRoles`
and `platformRole`. It mirrors `PERMISSIONS` and is **presentation only**, in the same way
`lib/club-fields.ts` already mirrors `EVENT_FIELDS`. Hiding a control is presentation,
never protection; the API refuses anything this file gets wrong.

Event-page actions are derived the same way, from `viewerClubRoles` and
`viewerResponsibilities`, both of which `eventDetailSchema` already carries:

| Action | Permission | Extra condition |
|---|---|---|
| Publish | `event:publish` | status is `DRAFT` |
| Edit | `event:edit` | which fields still governed by `EVENT_FIELDS` |
| Attendees | `registration:read` | grantable per-event by assignment |
| Check in | `attendance:scan` | the event is live |
| Cancel | `event:cancel` | at the foot of the edit screen, not the action row |

## 7. Tests that discriminate

Named here because each replaces a test that would pass against a badly broken
implementation.

- **`fromMyClubs` uses two users, two clubs and an existing registration.** A single-user,
  single-club fixture passes against an implementation that ignores the flag entirely.
- **`fromMyClubs` excludes a `WAITLISTED` registration, not only `CONFIRMED`.** Filtering
  on `CONFIRMED` alone duplicates every waitlisted event across two sections.
- **`past=true` is proven by an event that has started but not ended.** An implementation
  splitting on `startsAt` puts it in the wrong list; one splitting on `endsAt` does not.
  An event wholly in the future or wholly in the past distinguishes neither.
- **`pendingMemberCount` is `null` for an ACTIVE ordinary member of that club.** Asserting
  it against a stranger passes against an implementation that gates on membership rather
  than on `membership:decide`.
- **`club-sections` is table-driven across all five club roles plus Admin-holding-no-role.**
  This file decides what every officer can see; a test covering only `LEAD` proves nothing
  about the other four.
- **An officer is redirected out of `/manage/[clubId]` and an Admin is not.** Both
  directions, or the test passes against a layout that redirects everybody.

## 8. Out of scope

- The admin dashboard, `(admin)/**`. Untouched.
- The permission matrix itself. Nothing here adds, removes or widens a permission.
- The carried security items earlier notes pencilled against "Stage 9": `__Host-` cookie
  prefixes, `helmet`, `Cache-Control` on API responses, and authorization refusals
  returning HTTP 200. They keep their own slot and are not part of this stage.
- Rate limiting, dropped from the build 2026-09-13.
