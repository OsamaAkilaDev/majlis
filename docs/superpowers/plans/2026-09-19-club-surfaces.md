# Club surfaces, rebuilt

Approved direction: the v3 mock (student club page, join-state matrix, club
workspace, date ranges). This plan turns it into tasks.

## Why

Three defects the mock answers:

1. The student club page shows a name, a description and two numbers. A club's
   events, committee and department are all reachable through the API and none
   of them are on the page. The banner renders only when one was uploaded, so
   most clubs open on a bare heading.
2. Entering `/manage/[clubId]` replaces every platform navigation entry with
   seven club entries, with no breadcrumb and no route back. Nothing says the
   viewer is inside a club.
3. `GET /clubs/by-slug/:slug` has no status gate. A suspended or archived club
   opens for anyone holding its slug; the browser only hides them by passing
   `status=ACTIVE`, which is presentation, not protection.

## Phases

### 1. The club detail response carries the club

- `eventStatusSchema` moves to `common/enums` so `clubs` can name it without
  importing `events`, which imports `clubs`.
- `clubDetailSchema` gains `committee`, `upcoming`, `past` and `eventsRun`.
  `upcoming`/`past` are bounded previews, not pages: three rows and a
  lookahead, so the page knows whether to offer "see all" without a count
  query.
- `detailWhere` answers 404 for a club that is not ACTIVE unless the reader is
  Admin or holds an ACTIVE appointment in it. `list` forces `status=ACTIVE`
  for everyone but Admin. Both reuse one predicate in `roster-access.ts`.

### 2. Student club page

- Banner always draws: a deterministic gradient from the club id when no
  artwork was uploaded.
- Desktop is two columns: events wide, About / Committee / Department in a
  rail. Phone puts About behind one row that pushes `/clubs/[slug]/about`.
- The join button carries the membership policy in its label and its enabled
  state. No separate joining section anywhere.

### 3. The club workspace stops replacing the platform

- `/manage/[clubId]` keeps the platform rail (Admin's or the student's) and
  puts the club's seven sections in a tab row under a workspace bar carrying
  the breadcrumb, crest, name, status and actions.
- `(admin)/admin/clubs/[clubId]` redirects into the workspace; its two
  Admin-only panels (appoint Lead, change status) move onto the workspace
  overview behind the same role check.

### 4. WYSIWYG overview

- The overview is the student page with edit affordances: hover lifts a field,
  click turns it into an input, and a save bar appears once something is
  dirty. Spec 6.1's override reason rides on the save bar.

### 5. Date ranges

- Six `datetime-local` inputs become three React Aria range fields, with the
  cross-field rules `assertWindows` enforces checked as you type and drawn on
  a timeline.

## Out of scope

Founded year: no column exists, and adding one is a schema decision the mock
raised and nobody has taken. The stat is dropped rather than faked.
