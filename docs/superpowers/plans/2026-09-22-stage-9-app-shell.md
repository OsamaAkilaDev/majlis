# Stage 9: the app shell, restructured (implementation plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete `/home`, lead Events and Clubs with the viewer's own data, and fold every club officer capability onto the club and event it concerns, leaving `/manage/[clubId]` to Admins.

**Architecture:** Two shells for people, not three. Officer powers are affordances on the club and event pages, shown only to a viewer whose permission is re-derived server-side. Four contract additions and no migrations; almost every officer screen is an existing component moved to a new route.

**Tech Stack:** NestJS 12, Prisma 7, Next.js 16 App Router, Tailwind v4 + shadcn/ui, Zod 4 contracts, Vitest + Supertest for the API, Vitest for web units, Playwright for e2e.

**Spec:** [`docs/specs/2026-09-22-stage-9-app-shell-design.md`](../../specs/2026-09-22-stage-9-app-shell-design.md), which is binding for this plan. Its parent is [`docs/specs/2026-09-10-majlis-design.md`](../../specs/2026-09-10-majlis-design.md) §9.1, §13.

## Global Constraints

Copied from the spec and `CLAUDE.md`. Every task's requirements implicitly include this section.

- **Node 22.12 is a hard floor.** NestJS 12 is ESM-only and this app is CommonJS, so it depends on `require(esm)`.
- **Write through `TransactionHost`, never `PrismaService`.** `host.tx` is the ambient transaction; `host.run(fn)` starts one or joins the caller's. An ESLint boundary rule enforces this outside `src/prisma/`.
- **Services throw `DomainError` subclasses** (`NotFoundError`, `ForbiddenError`, `ConflictError`, `UnprocessableError`), never `@nestjs/common` exceptions.
- **Audit sensitive actions in the same transaction as the action.** Nothing in this stage adds a sensitive action; nothing here removes an audit row either.
- **Server-side authorization on every protected endpoint**, re-derived from the database per request. A slug or ID in a URL is a claim, never a permission. Hiding a control is presentation, never protection.
- **OpenAPI is generated from code.** Zod schemas in `packages/contracts` are the single source of truth. Never hand-edit the document.
- **Every enum needs `@@map`.** No enum is added in this stage.
- **Use the `API_PREFIX` constant.** Its leading slash is load-bearing.
- **Never render a page then show an "authentication required" panel. Redirect instead.**
- **English only. No em dashes** anywhere: chat, docs, commits, comments or UI copy.
- **No explanatory UI copy.** No taglines, helper text or empty-state paragraphs. Layout guides, not prose.
- **`build` is `tsc`.** `@nestjs/cli` is deliberately absent and must not be reinstalled. The dev loop is SWC, not `tsx`.
- **pnpm 11 refuses packages published in the last 24 hours.** No dependency is added in this stage.
- **Restart `next dev` between e2e runs.** A stale server hits Node's 4 GB cap and fakes "element not found" failures.
- **~12 integration failures on a clean checkout come from `.env` secrets, not code.** Check that before blaming a change.

## Commands

```bash
pnpm --filter @majlis/contracts test      # contract unit tests
pnpm --filter @majlis/api test            # API unit + integration
pnpm --filter @majlis/web test            # web unit tests
pnpm --filter @majlis/web test:e2e        # Playwright
pnpm build                                # tsc across the workspace
```

## File map

**`packages/contracts/src/`**
- `events/index.ts`: `fromMyClubs` on the list query, `clubSlug` on the summary, a new `myRegistrationListQuerySchema`
- `clubs/index.ts`: `pendingMemberCount` on the detail; `upcoming`, `past` and `CLUB_EVENT_PREVIEW` deleted

**`apps/api/src/`**
- `events/events.service.ts`: `fromMyClubs` filter, `clubSlug` in `SUMMARY_SELECT` and `toSummary`
- `events/registrations.service.ts`: `past` on `mine()`
- `events/registrations.controller.ts`: a query DTO for `GET /me/registrations`
- `clubs/clubs.service.ts`: `pendingMemberCount`; the two event previews deleted

**`apps/web/src/`**
- `lib/club-sections.ts` (new): which officer sections a viewer reaches; mirrors `PERMISSIONS`
- `lib/event-actions.ts` (new): which officer actions an event page offers
- `components/shell/student-nav.tsx`, `components/shell/TabBar.tsx`, `lib/routing.ts`: three tabs, new landing
- `app/(student)/events/**`, `app/(student)/clubs/**`: the screens
- `app/(club)/manage/[clubId]/layout.tsx`: Admin-only, redirect otherwise

**Moved wholesale, logic unchanged:** `ClubProfile.tsx` (stays in `components/`), `MembersManager`, `TeamManager`, `ClubReports`, `EventFields`, `ClubBrowser`, `EventBrowser`.

**Split, not moved:** `EventEditor.tsx` is 576 lines and is four screens in a trench coat: the form, the assignment roster, the registration roster and the attendance corrections. It divides across `/events/[eventId]/edit` and `/events/[eventId]/attendees` along the permission seam, not down the middle. See Task 5, Step 4.

**Loses a feature:** `ScanSession` drops its event picker and the `/events?clubId=` fetch behind it.

---

## Task 1: Contracts

**Files:**
- Modify: `packages/contracts/src/events/index.ts`
- Modify: `packages/contracts/src/clubs/index.ts`
- Test: `packages/contracts/src/events/index.test.ts`, `packages/contracts/src/clubs/index.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `EventListQuery.fromMyClubs?: boolean`; `EventSummary.clubSlug: string`; `myRegistrationListQuerySchema` / `MyRegistrationListQuery` with `past?: boolean`; `ClubDetail.pendingMemberCount: number | null`. Removes `ClubDetail.upcoming`, `ClubDetail.past`, `ClubEvent`, `clubEventSchema` and `CLUB_EVENT_PREVIEW`.

- [ ] **Step 1: Add the three event-side changes**

In `events/index.ts`, `eventListQuerySchema` gains one key. `z.stringbool()` is what `upcoming` already uses, because a query string carries `"true"`, not `true`:

```ts
export const eventListQuerySchema = cursorPageQuerySchema.extend({
  clubId: z.uuid().optional(),
  status: eventStatusSchema.optional(),
  q: z.string().trim().min(1).max(160).optional(),
  /** Only events that have not ended yet. */
  upcoming: z.stringbool().optional(),
  /**
   * Events from clubs the caller is an ACTIVE member of, minus any they already
   * hold a non-cancelled registration for. Orthogonal to `upcoming`, which it
   * does not imply: the Events screen sends both.
   */
  fromMyClubs: z.stringbool().optional(),
  /** `desc` is for a picker that has to reach the event somebody just made. */
  direction: z.enum(['asc', 'desc']).optional(),
});
```

`eventSummarySchema` gains `clubSlug` beside the two club fields it already carries:

```ts
  clubId: z.uuid(),
  clubName: z.string(),
  clubSlug: z.string(),
  clubLogoUrl: z.string(),
```

And a query schema for `GET /me/registrations`, placed next to `myRegistrationSchema`:

```ts
/**
 * Absent means every registration, which is what /profile/registrations has
 * always shown and must keep showing. `true` is ended events, `false` is
 * events still to come; both split on the event's END, so one that has started
 * but not finished is still upcoming.
 */
export const myRegistrationListQuerySchema = cursorPageQuerySchema.extend({
  past: z.stringbool().optional(),
});

export type MyRegistrationListQuery = z.infer<typeof myRegistrationListQuerySchema>;
```

- [ ] **Step 2: Add `pendingMemberCount` and delete the previews**

In `clubs/index.ts`, delete `clubEventSchema`, its `ClubEvent` type export, and the `CLUB_EVENT_PREVIEW` constant with its comment block. Then `clubDetailSchema` loses two keys and gains one:

```ts
export const clubDetailSchema = clubSummarySchema.extend({
  description: z.string(),
  academicYear: z.string(),
  bannerUrl: z.string().nullable(),
  departmentId: z.uuid(),
  /** The viewer's own relationship to this club. Never another user's. */
  viewerMembershipStatus: membershipStatusSchema.nullable(),
  viewerClubRoles: z.array(clubRoleSchema),
  committee: z.array(committeeMemberSchema),
  /**
   * Null, never 0, for a viewer without `membership:decide` in this club:
   * "you may not see this" and "there are none" are different facts, and a
   * zero would let the Manage badge disappear for the wrong reason.
   */
  pendingMemberCount: z.number().int().nonnegative().nullable(),
  /** Events this club has actually run: COMPLETED or CERTIFIED. */
  eventsRun: z.number().int().nonnegative(),
});
```

`eventStatusSchema` stays imported from `../common/enums` only if something else in the file still uses it; if not, drop the import. `tsc` will say.

- [ ] **Step 3: Test the one thing a schema can get wrong here**

Add to `clubs/index.test.ts`. The discriminating case is `null` versus absent, because `z.number().nullable()` and `z.number().nullish()` differ only here, and the wrong one lets the API omit the key and every client read `undefined`:

```ts
it('accepts a null pending count and refuses an absent one', () => {
  // On the field, not a whole fixture: `.nullable()` and `.nullish()` differ
  // only here, and the wrong one lets the API omit the key while every client
  // reads `undefined` and renders no badge for a club with twelve requests.
  const field = clubDetailSchema.shape.pendingMemberCount;
  expect(field.safeParse(null).success).toBe(true);
  expect(field.safeParse(3).success).toBe(true);
  expect(field.safeParse(undefined).success).toBe(false);
});
```

Add to `events/index.test.ts`, proving the query flags parse the strings a URL actually carries, which a `z.boolean()` would not:

```ts
// Each assertion goes in the describe block for the schema it exercises,
// and each flag is asserted for BOTH strings. The 'false' case is the whole
// test: z.coerce.boolean() is Boolean(input), and Boolean('true') is true
// too, so a 'true'-only assertion passes against the exact bug being guarded.
it('reads fromMyClubs out of a query string, both ways', () => {
  expect(eventListQuerySchema.parse({ fromMyClubs: 'true' }).fromMyClubs).toBe(true);
  expect(eventListQuerySchema.parse({ fromMyClubs: 'false' }).fromMyClubs).toBe(false);
});

it('reads past out of a query string, and leaves it undefined when absent', () => {
  expect(myRegistrationListQuerySchema.parse({ past: 'true' }).past).toBe(true);
  expect(myRegistrationListQuerySchema.parse({ past: 'false' }).past).toBe(false);
  expect(myRegistrationListQuerySchema.parse({}).past).toBeUndefined();
});
```

- [ ] **Step 4: Run the contract tests**

Run: `pnpm --filter @majlis/contracts test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts
git commit -m "feat(contracts)!: the viewer's own events, and a pending count on the club"
```

---

## Task 2: The API

**Files:**
- Modify: `apps/api/src/events/events.service.ts` (`SUMMARY_SELECT` ~line 40, `toSummary` ~line 119, `list` ~line 281)
- Modify: `apps/api/src/events/registrations.service.ts` (`mine` ~line 273)
- Modify: `apps/api/src/events/registrations.controller.ts` (`GET /me/registrations` ~line 61)
- Modify: `apps/api/src/clubs/clubs.service.ts` (`detailWhere` ~line 318)
- Test: `apps/api/test/events.integration.test.ts`, `apps/api/test/registrations.integration.test.ts`, `apps/api/test/clubs-create.integration.test.ts`

**Interfaces:**
- Consumes: Task 1's schemas.
- Produces: `GET /events?fromMyClubs=true`, `GET /me/registrations?past=`, `clubSlug` on every event summary, `pendingMemberCount` on every club detail. No route is added, removed or renamed.

- [ ] **Step 1: `clubSlug` on the event summary**

`SUMMARY_SELECT` already joins the club for its name and logo. One column:

```ts
  club: { select: { name: true, slug: true, logoUrl: true } },
```

and in `toSummary`, beside `clubName`:

```ts
    clubSlug: row.club.slug,
```

`tsc` finds every other construction site.

- [ ] **Step 2: `fromMyClubs` on the event list**

`list()` composes its where clause by spreading `filters`, which means a second fragment carrying `clubId` would silently overwrite `query.clubId`. Compose with `AND` instead. Add the helper beside `visibilityFilter`:

```ts
/**
 * The viewer's own clubs, minus what they already hold a place at: an event in
 * Registered must not also appear in From your clubs. Excluded server-side
 * because de-duplicating on the client is right for the first page and wrong
 * for every page after it.
 *
 * An empty membership list yields `{ in: [] }`, which correctly matches
 * nothing. Both halves are indexed: club_membership(user_id, status) and
 * event_registration's own user index.
 */
private async myClubsFilter(actor: Actor): Promise<Prisma.EventWhereInput> {
  const memberships = await this.host.tx.clubMembership.findMany({
    where: { userId: actor.id, status: 'ACTIVE' },
    select: { clubId: true },
  });

  return {
    clubId: { in: memberships.map((m) => m.clubId) },
    registrations: { none: { userId: actor.id, status: { not: 'CANCELLED' } } },
  };
}
```

and in `list()`, replacing the `where` line:

```ts
  const visible = await this.visibilityFilter(actor);
  const mine = query.fromMyClubs ? await this.myClubsFilter(actor) : null;
  const and = [filters, visible, mine].filter(
    (f): f is Prisma.EventWhereInput => f !== null && f !== undefined,
  );

  const rows = await this.host.tx.event.findMany({
    where: { AND: and },
    ...cursorArgs(query, query.direction),
    select: SUMMARY_SELECT,
  });
```

`status: { not: 'CANCELLED' }` and not `status: 'CONFIRMED'`. A waitlisted place is a place; filtering on `CONFIRMED` duplicates every waitlisted event across both sections of the screen.

- [ ] **Step 3: `past` on `GET /me/registrations`**

In `registrations.controller.ts`, replace the bare `CursorPageQueryDto` with its own DTO, declared beside the others at the top of the file:

```ts
class MyRegistrationListQueryDto extends createZodDto(myRegistrationListQuerySchema) {}
```

```ts
  @Get('me/registrations')
  mine(
    @Actor() actor: User,
    @Query() query: MyRegistrationListQueryDto,
  ): Promise<MyRegistrationPage> {
    return this.registrations.mine(actor, query);
  }
```

In `registrations.service.ts`, `mine()` takes `MyRegistrationListQuery` and gains one clause. `OPEN` stays: a cancelled registration belongs in neither list.

```ts
  async mine(actor: Actor, query: MyRegistrationListQuery): Promise<MyRegistrationPage> {
    // Split on the event's END, not its start: one that is running right now
    // has not passed. Absent means every registration, which is what
    // /profile/registrations has always shown.
    const now = new Date();
    const window =
      query.past === undefined
        ? {}
        : { event: query.past ? { endsAt: { lt: now } } : { endsAt: { gte: now } } };

    const rows = await this.host.tx.eventRegistration.findMany({
      where: { userId: actor.id, ...OPEN, ...window },
      ...cursorArgs(query),
      include: { event: { select: EVENT_SUMMARY_SELECT } },
    });
```

The rest of the method is unchanged.

- [ ] **Step 4: `pendingMemberCount` on the club detail, and delete the previews**

Prisma cannot alias two filtered counts of the same relation, so this is a second query, and it is only paid by a viewer who can see the answer. Reuse `matches` from the permission matrix rather than restating the role list; it is exported for exactly this.

At the top of `clubs.service.ts`:

```ts
import { matches, PERMISSIONS } from '../auth/permissions';
```

In `detailWhere`, delete the `const take = CLUB_EVENT_PREVIEW + 1;` line and the whole `Promise.all([...])` that fetches `upcoming` and `past`, then:

```ts
    // A second query rather than a second `_count` entry: Prisma cannot alias
    // two filtered counts of one relation. Skipped entirely for a viewer who
    // may not see it, and null for them rather than 0, so the Manage badge
    // cannot vanish for the wrong reason.
    const canDecide = matches(PERMISSIONS['membership:decide'], {
      userId: actor.id,
      platformRole: actor.platformRole,
      clubRoles: viewerClubRoles,
      eventResponsibilities: [],
    });

    const pendingMemberCount = canDecide
      ? await this.host.tx.clubMembership.count({ where: { clubId, status: 'PENDING' } })
      : null;

    return toClubDetail(club, club.department.name, club._count.memberships, {
      viewerMembershipStatus: club.memberships[0]?.status ?? null,
      viewerClubRoles,
      committee: toCommittee(club.appointments),
      pendingMemberCount,
      eventsRun: club._count.events,
    });
```

Then delete what is now unreachable in that file: `CLUB_EVENT_SELECT`, `toClubEvent`, `PUBLIC_UPCOMING`, the `upcoming`/`past` fields on the `toClubDetail` extras interface and its empty-state default, and the `CLUB_EVENT_PREVIEW` import. `RAN` stays; `_count.events` uses it. Run `tsc` and let it enumerate the rest.

- [ ] **Step 5: Write the integration tests that discriminate**

Four, named here with the fixture each needs, because each replaces an easy test that passes against a broken implementation.

In `events.integration.test.ts`:

```
'fromMyClubs returns only the caller's own clubs'
  Two users and two clubs. userA is ACTIVE in clubA only. Both clubs have a
  published upcoming event. Assert userA sees clubA's and not clubB's, AND
  that userB sees the mirror image. One user and one club passes against an
  implementation that ignores the flag.

'fromMyClubs excludes an event the caller is WAITLISTED for'
  One club, two published events, the caller ACTIVE in the club and
  WAITLISTED (not CONFIRMED) on one. Assert only the other comes back.
  Filtering on CONFIRMED alone passes a test that uses a confirmed place.

'fromMyClubs returns nothing for a caller in no clubs'
  Guards the `{ in: [] }` path, which an implementation that skips the filter
  when the list is empty turns into "every event in the university".
```

In `registrations.integration.test.ts`:

```
'past splits on the event's end, not its start'
  Three events: one wholly past, one wholly future, one STARTED BUT NOT
  ENDED, with the caller registered for all three. Assert the running one is
  in `past=false` and not in `past=true`. Without that third event the test
  passes against an implementation that splits on startsAt.

'an absent past returns every registration'
  Same fixture, no flag. Asserts /profile/registrations did not change
  behaviour.
```

In `clubs-create.integration.test.ts` (or wherever club detail is already exercised):

```
'pendingMemberCount is null for an ordinary active member'
  A club with one PENDING request. Read the detail as: the Lead (expect the
  number), an ACTIVE ordinary member (expect null), and an Admin holding no
  role in the club (expect the number). The ordinary member is the case that
  matters: asserting against a stranger passes against an implementation
  gating on membership rather than on `membership:decide`.
```

- [ ] **Step 6: Run the API suite**

Run: `pnpm --filter @majlis/api test`
Expected: PASS. If roughly a dozen unrelated integration tests fail, check `.env` secrets before blaming this change.

- [ ] **Step 7: Prove the index tests discriminate**

For each of the five tests above, break the implementation deliberately and watch it go red: change `{ not: 'CANCELLED' }` to `'CONFIRMED'`, `endsAt` to `startsAt`, and `canDecide` to `viewerClubRoles.length > 0`. Restore. A test that stays green under one of those is not testing anything and must be rewritten before moving on.

- [ ] **Step 8: Commit**

```bash
git add apps/api
git commit -m "feat(api): events from the viewer's own clubs, past registrations, a pending count"
```

---

## Task 3: The shell, three tabs and a new landing

**Files:**
- Delete: `apps/web/src/app/(student)/home/`
- Modify: `apps/web/src/components/shell/student-nav.tsx`, `apps/web/src/components/shell/TabBar.tsx`
- Modify: `apps/web/src/lib/routing.ts`
- Modify: `apps/web/src/app/(student)/error.tsx`, `apps/web/src/app/(club)/error.tsx`
- Modify: `apps/web/src/app/(student)/profile/page.tsx`
- Modify: `apps/web/src/app/(club)/manage/[clubId]/layout.tsx`
- Test: `apps/web/src/lib/routing.test.ts`

**Interfaces:**
- Consumes: nothing from Tasks 1 and 2.
- Produces: `STUDENT_TABS` of length 3; `landingFor(user)` returning `/admin` or `/events`; `shellDestinations(user)` returning at most one entry.

- [ ] **Step 1: Three tabs**

`student-nav.tsx`: drop the `House` import and the Home entry, and put Events first.

```ts
export const STUDENT_TABS = [
  { href: '/events', label: 'Events', icon: CalendarDots },
  { href: '/clubs', label: 'Clubs', icon: Users },
  { href: '/profile/qr', label: 'QR', icon: QrCode },
] as const;
```

`TabBar.tsx`: **two** numbers change, and the second is easy to miss. The grid:

```
grid-cols-4  ->  grid-cols-3
```

and the travelling pill's width, which is computed from the count and is why a
find-and-replace on `grid-cols` alone leaves the pill landing between tabs:

```
w-[calc((100%-0.75rem)/4)]  ->  w-[calc((100%-0.75rem)/3)]
```

`0.75rem` is the nav's `p-1.5` on both sides and does not change.

- [ ] **Step 2: The new landing and no switcher**

`routing.ts`. An officer used to land in a console; now nobody does.

```ts
export function landingFor(user: SessionUser): string {
  return user.platformRole === 'ADMIN' ? '/admin' : '/events';
}
```

```ts
/** At most one entry. A club is reached from the Clubs tab, where the viewer's
 *  own sit at the top wearing their role, so a switcher listing them again is
 *  a second route to the same place. */
export function shellDestinations(user: SessionUser): ShellDestination[] {
  return user.platformRole === 'ADMIN' ? [{ href: '/admin', label: 'Admin' }] : [];
}
```

`enumLabel` and the `clubName`/`role` reads go with it; drop the import if `tsc` says it is now unused. Leave `ShellDestination.meta` in place, it costs nothing and the admin entry may want it.

- [ ] **Step 3: The two error boundaries and the profile screen**

Both `error.tsx` files: `home={{ href: '/events', label: 'Events' }}`.

`profile/page.tsx`: the filter and its comment go, because there is no Home to exclude any more.

```ts
const consoles = shellDestinations(user);
```

- [ ] **Step 4: `/manage/[clubId]` becomes Admin-only**

Spec §9.1 keeps routing rules as pure, unit-tested functions, so the decision goes in `routing.ts` next to the others rather than living only inside a layout no test can reach:

```ts
/** Where a viewer of the club console belongs instead, or null if they belong
 *  there. The console is Admin-only as of Stage 9; an officer does their work
 *  inside the application, on the club page itself. */
export function consoleRedirect(user: SessionUser, clubSlug: string | null): string | null {
  if (user.platformRole === 'ADMIN') return null;
  return clubSlug ? `/clubs/${clubSlug}` : '/clubs';
}
```

`manage/[clubId]/layout.tsx` then reads. Redirect, never a panel. An officer can still read their own club by ID, so the slug is available to redirect to:

```ts
  const { clubId } = await params;
  const user = await requireUser();

  // Re-derived from the database on every request: a club ID in the URL is a
  // claim, never a permission.
  const club = await serverFetch<ClubDetail>(`/clubs/${clubId}`);

  const away = consoleRedirect(user, club?.slug ?? null);
  if (away) redirect(away);

  return (
    <ConsoleFrame items={ADMIN_NAV} session={{ user }}>
      <ClubWorkspace
        clubId={clubId}
        club={club}
        sections={clubSections(clubId)}
        backHref="/admin/clubs"
      >
        {children}
      </ClubWorkspace>
    </ConsoleFrame>
  );
```

`redirect` comes from `next/navigation`. The `STUDENT_NAV` import, the `holdsRole` line and the `isAdmin` branch on `backHref` all go. `PageError` may now be unused in this file.

- [ ] **Step 5: Update the routing tests**

`routing.test.ts` names `/home` in eight places. The three that carry meaning:

```ts
it('sends every non-admin to events, officer or not', () => {
  expect(landingFor(user())).toBe('/events');
  expect(landingFor(user({ clubRoles: [{ clubId: 'c1', clubName: 'Robotics', role: 'LEAD' }] })))
    .toBe('/events');
  expect(landingFor(user({ platformRole: 'ADMIN' }))).toBe('/admin');
});

it('gives a club officer no shell destination at all', () => {
  expect(shellDestinations(user({ clubRoles: [{ clubId: 'c1', clubName: 'Robotics', role: 'LEAD' }] })))
    .toEqual([]);
});

it('gives an admin exactly one', () => {
  expect(shellDestinations(user({ platformRole: 'ADMIN' }))).toEqual([
    { href: '/admin', label: 'Admin' },
  ]);
});
```

The officer case in the first test is the one that matters: it is the behaviour being reversed, and a test that only checks a plain student passes against the old function unchanged. Update the `TABS` fixture to the three new hrefs and leave the `activeNavHref` tests otherwise alone.

Then the console gate, in **both** directions, or it passes against a layout that redirects everybody:

```ts
it('sends a club officer out of the console and leaves an admin in it', () => {
  const lead = user({ clubRoles: [{ clubId: 'c1', clubName: 'Robotics', role: 'LEAD' }] });
  expect(consoleRedirect(lead, 'robotics')).toBe('/clubs/robotics');
  expect(consoleRedirect(user({ platformRole: 'ADMIN' }), 'robotics')).toBeNull();
});

it('sends an officer to the club list when the club could not be read', () => {
  expect(consoleRedirect(user(), null)).toBe('/clubs');
});
```

- [ ] **Step 6: Run and commit**

Run: `pnpm --filter @majlis/web test`
Expected: PASS.

```bash
git add apps/web
git commit -m "feat(web)!: three tabs, no home, and the club console closes to officers"
```

---

## Task 4: Events and Clubs lead with the viewer's own

**Files:**
- Create: `apps/web/src/app/(student)/events/discover/page.tsx`, `apps/web/src/app/(student)/clubs/discover/page.tsx`
- Move: `events/EventBrowser.tsx` to `events/discover/EventBrowser.tsx`; `clubs/ClubBrowser.tsx` to `clubs/discover/ClubBrowser.tsx`
- Rewrite: `apps/web/src/app/(student)/events/page.tsx`, `apps/web/src/app/(student)/clubs/page.tsx`
- Create: `apps/web/src/app/(student)/events/EventGroups.tsx`, `apps/web/src/app/(student)/clubs/ClubGroups.tsx`
- Modify: `apps/web/src/lib/events.ts` (`myRegistrations` takes the new query), `apps/web/src/lib/clubs.ts` (add `myClubs`)
- Modify: `apps/web/src/components/shell/StudentShell.tsx` (an optional header action slot)

**Interfaces:**
- Consumes: Task 1's `fromMyClubs`, `past`, `clubSlug`; Task 3's tabs.
- Produces: `myClubs(query: CursorPageQuery): Promise<MyClubPage>` in `lib/clubs.ts`; `StudentShell` accepting an optional `action?: ReactNode` rendered between the title and the bell.

- [ ] **Step 1: A header action slot on the shell**

`StudentShell` takes `title` and `children` today. Discovery is reached from a search control in the header on both screens, so the shell needs one slot. Keep it a single optional node, not an array: two screens need one control each.

```tsx
export function StudentShell({
  title,
  action,
  children,
}: {
  title: string;
  /** Rendered between the title and the bell. One control, not a toolbar. */
  action?: ReactNode;
  children: ReactNode;
}) {
```

and in the header, immediately before `<NotificationBell />`:

```tsx
        {action}
```

The title already carries `min-w-0 flex-1 truncate`, so a third 44px control shortens the title rather than overflowing. Verify at 320px.

- [ ] **Step 2: Move the two browsers to their own routes, unchanged**

`git mv` both components. The new pages are the current `events/page.tsx` and `clubs/page.tsx` verbatim, retitled, with `StudentShell title="Discover"` and no other change. They keep their `?club=` and `?department=` search params, which existing links already use.

- [ ] **Step 3: The Events screen**

`events/page.tsx` fetches three groups in parallel on the server. `PAGE` is the student page size from `lib/page-size.ts`.

```tsx
  const [registered, fromClubs, past] = await Promise.all([
    serverFetch<MyRegistrationPage>(`/me/registrations?past=false&limit=${PAGE}`),
    serverFetch<EventPage>(`/events?upcoming=true&fromMyClubs=true&limit=${PAGE}`),
    serverFetch<MyRegistrationPage>(`/me/registrations?past=true&limit=${PAGE}`),
  ]);
```

`fromMyClubs` does not imply `upcoming`, so both are sent.

`EventGroups.tsx` renders three sections in that order: Registered, From your clubs, Past. Each section is a `font-display text-h1` heading with a count beside it, and disappears entirely when empty rather than carrying an empty-state panel, except that when all three are empty the screen shows one `EmptyState` with a link to `/events/discover`. No explanatory copy anywhere.

A Registered row carries the viewer's own `status` as a `StatusBadge`, plus `viewerWaitlistPosition` when waitlisted. A From-your-clubs row carries seats left. A Past row carries the event status.

The header action is a link, not a button, so it is a real navigation:

```tsx
<Link href="/events/discover" aria-label="Discover events" className="...">
  <MagnifyingGlass size={22} weight={ICON_WEIGHT} aria-hidden />
</Link>
```

- [ ] **Step 4: The Clubs screen**

Add to `lib/clubs.ts`, beside `myInvitations`, using the same `qs` helper it already imports from `./api`:

```ts
export const myClubs = (query: CursorPageQuery): Promise<MyClubPage> =>
  apiFetch(`/me/clubs${qs({ cursor: query.cursor, limit: query.limit })}`);
```

`MyClubPage` is already in that file's import list.

`clubs/page.tsx` fetches `/me/clubs?limit=${PAGE}` once. `ClubGroups.tsx` splits the result by `status`: `ACTIVE` under "Your clubs", `PENDING` under "Requested". `MyClub` carries `clubRoles`, so a club the viewer runs shows its role as a chip; that chip is the officer's fast path and is the reason this screen is worth leading with. Rows link to `/clubs/${club.slug}`.

A `Browse all clubs` row closes the list, pushing `/clubs/discover`, and stands alone as the whole screen when the viewer belongs to nothing. The header carries the same search link as Events.

- [ ] **Step 5: Verify against the real app**

Run the dev server and check, at 390px and at desktop width: all three event groups, a waitlisted registration showing its position, a viewer in no clubs seeing the empty path on both screens, and the dock pill landing centred on each of the three tabs.

Restart `next dev` before any e2e run.

- [ ] **Step 6: Commit**

```bash
git add apps/web
git commit -m "feat(web): events and clubs open on the viewer's own, discovery moves behind a route"
```

---

## Task 5: Officer capability on the club and the event

**Files:**
- Create: `apps/web/src/lib/club-sections.ts`, `apps/web/src/lib/event-actions.ts`
- Test: `apps/web/src/lib/club-sections.test.ts`, `apps/web/src/lib/event-actions.test.ts`
- Create: `apps/web/src/app/(student)/clubs/[slug]/ManageSheet.tsx`
- Create: `clubs/[slug]/{edit,members,team,reports,events/new}/page.tsx`
- Create: `events/[eventId]/{edit,attendees,check-in}/page.tsx`
- Modify: `apps/web/src/app/(student)/clubs/[slug]/ClubDetail.tsx`, `events/[eventId]/EventDetail.tsx`
- Move: `MembersManager`, `TeamManager`, `ClubReports`, `EventFields`, `ScanSession` out of `(club)/manage/` into the new routes
- Split: `(club)/manage/[clubId]/events/[eventId]/EventEditor.tsx` across the `edit` and `attendees` routes
- Delete: `(club)/manage/[clubId]/events/EventsManager.tsx`

**Interfaces:**
- Consumes: Tasks 1 to 4.
- Produces: `clubSectionsFor(clubRoles, platformRole): ClubSection[]`; `eventActionsFor(event, now): EventAction[]`.

- [ ] **Step 1: `club-sections.ts`, mirroring the matrix**

Same shape as `lib/club-fields.ts`, which mirrors the API's field buckets and is kept honest by a test that parses the API source. Certificates is deliberately absent: `certificate:manage` is Admin-only with no club role, so offering a Lead that row promises a screen the API refuses.

```ts
import type { ClubRole, SessionUser } from '@majlis/contracts';

/**
 * A mirror of PERMISSIONS in `apps/api/src/auth/permissions.ts`, kept honest by
 * club-sections.test.ts, which parses that file and compares.
 *
 * Presentation only: it decides which rows the Manage sheet offers. The server
 * re-derives the same decision from the database and is the protection.
 */
export type ClubSectionKey = 'edit' | 'members' | 'team' | 'reports';

/** The `club` array of the permission each section needs. */
export const CLUB_SECTION_ROLES = {
  edit: ['LEAD', 'VICE_LEAD', 'MARKETING'],
  members: ['LEAD', 'VICE_LEAD', 'OPERATIONS'],
  team: ['LEAD'],
  reports: ['LEAD', 'VICE_LEAD'],
} as const satisfies Record<ClubSectionKey, readonly ClubRole[]>;

export interface ClubSection {
  key: ClubSectionKey;
  label: string;
  /** Appended to `/clubs/{slug}/`. */
  path: string;
}

const SECTIONS: ClubSection[] = [
  { key: 'edit', label: 'Edit club', path: 'edit' },
  { key: 'members', label: 'Members', path: 'members' },
  { key: 'team', label: 'Team', path: 'team' },
  { key: 'reports', label: 'Reports', path: 'reports' },
];

export function clubSectionsFor(
  clubRoles: readonly ClubRole[],
  platformRole: SessionUser['platformRole'],
): ClubSection[] {
  if (platformRole === 'ADMIN') return SECTIONS;
  return SECTIONS.filter((s) => CLUB_SECTION_ROLES[s.key].some((r) => clubRoles.includes(r)));
}
```

`club-sections.test.ts` parses the API module the way `club-fields.test.ts` does. Each `PERMISSIONS` entry is one brace pair with no nesting, so a per-permission regex is enough:

```ts
const SOURCE = '../api/src/auth/permissions.ts';
const NEEDED = {
  edit: 'club:edit',
  members: 'membership:decide',
  team: 'club:team-manage',
  reports: 'report:read',
} as const;

function apiClubRoles(permission: string): string[] {
  const source = readFileSync(SOURCE, 'utf8');
  const entry = new RegExp(`'${permission}': \\{([^}]*)\\}`, 's').exec(source);
  if (!entry?.[1]) throw new Error(`${permission} is not in ${SOURCE}`);
  const club = /club: \[([^\]]*)\]/.exec(entry[1]);
  return (club?.[1] ?? '').split(',').map((r) => r.trim().replace(/'/g, '')).filter(Boolean);
}
```

Then a table-driven case across every club role, which is the point of the file:

```ts
it.each([
  ['LEAD', ['edit', 'members', 'team', 'reports']],
  ['VICE_LEAD', ['edit', 'members', 'reports']],
  ['OPERATIONS', ['members']],
  ['MARKETING', ['edit']],
  ['CTO', []],
] as const)('gives %s exactly its own sections', (role, expected) => {
  expect(clubSectionsFor([role], 'STUDENT').map((s) => s.key)).toEqual(expected);
});
```

plus: an ACTIVE member holding no role gets `[]`, an Admin holding no role gets all four, and no section is ever `certificates`. A test covering `LEAD` alone proves nothing about the other four, which is why this one is table-driven.

- [ ] **Step 2: The Manage sheet**

`ManageSheet.tsx` uses the existing shadcn `Sheet` with `side="bottom"`. The trigger is a `Button variant="outline"` labelled `Manage`, carrying `club.pendingMemberCount` as a badge when it is a non-zero number; `null` and `0` both render no badge, for different reasons. The whole control is absent when `clubSectionsFor(...)` is empty, so a CTO and an ordinary member see the same page.

Rows are `Link`s to `/clubs/${slug}/${section.path}`, each at least 56px tall, with a trailing chevron. The Members row carries the pending count as its own line when there is one.

`ClubDetail.tsx` gains the action row above the stats: `+ New event` as the primary when the viewer holds `event:create` (`LEAD`, `VICE_LEAD`, or Admin), then `Manage`. For a viewer with neither, `JoinControl` keeps that row to itself exactly as today. `JoinControl.decide` currently returns `{ kind: 'console' }` pointing at `/manage/${club.id}`; that branch goes, because an officer is already where they need to be.

- [ ] **Step 3: Move the four club officer screens**

Each new page resolves the slug server-side, gates on the real permission, and renders the existing manager with the club's ID. `getClubBySlug` already exists in `lib/clubs.ts`. The pattern, for `members`:

```tsx
export const metadata: Metadata = { title: 'Members' };

export default async function MembersPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [user, club] = await Promise.all([
    requireUser(),
    serverFetch<ClubDetail>(`/clubs/by-slug/${encodeURIComponent(slug)}`),
  ]);
  if (!club) notFound();

  if (clubSectionsFor(club.viewerClubRoles, user.platformRole).every((s) => s.key !== 'members')) {
    redirect(`/clubs/${slug}`);
  }

  // Two more round trips than the console paid, because the slug had to
  // resolve first. PAGE, not CONSOLE_PAGE: this is a phone screen now.
  const [pending, active] = await Promise.all([
    serverFetch<MemberPage>(`/clubs/${club.id}/members?status=PENDING&limit=${PAGE}`),
    serverFetch<MemberPage>(`/clubs/${club.id}/members?status=ACTIVE&limit=${PAGE}`),
  ]);

  return (
    <StudentShell title="Members">
      <MembersManager
        clubId={club.id}
        initialClub={club}
        initialPending={pending}
        initialActive={active}
      />
    </StudentShell>
  );
}
```

`MembersManager`'s own props are unchanged: `clubId`, `initialClub`, `initialPending`, `initialActive`. Its table layout needs a responsive pass for phone widths; the approve and decline controls must stay at least 44px.

`clubSectionsFor` is presentation elsewhere but is a real gate here, and that is fine: it is derived from `club.viewerClubRoles`, which the server computed from the database for this request. The API refuses regardless.

`edit` renders `ClubProfile` unchanged. `reports` renders `ClubReports`. `team` renders `TeamManager`. `events/new` renders the create panel lifted out of `EventsManager`, then `EventsManager` itself is deleted; the club page's Events tab lists through `listEvents({ clubId })`, which is role-aware and so shows an officer their drafts, which the deleted `ClubDetail.upcoming` preview could not.

- [ ] **Step 4: `event-actions.ts` and the three event routes**

```ts
export type EventActionKey = 'edit' | 'publish' | 'attendees' | 'checkIn' | 'cancel';
```

`eventActionsFor(event: EventDetail, now: Date)` reads `viewerClubRoles` and `viewerResponsibilities`, both already on the wire, and returns the subset that applies:

| Key | `club` roles | `event` responsibilities | Extra condition |
|---|---|---|---|
| `publish` | `LEAD`, `VICE_LEAD` | none | `event.status === 'DRAFT'` |
| `edit` | all five | none | none |
| `attendees` | `LEAD`, `VICE_LEAD` | `EVENT_LEAD`, `OPERATIONS` | none |
| `checkIn` | `LEAD`, `OPERATIONS` | `EVENT_LEAD`, `OPERATIONS` | the event is live |
| `cancel` | `LEAD` | none | status is not terminal |

Admin holds all of them. `event-actions.test.ts` parses the same permission entries the way Task 5 Step 1 does, and covers: an `OPERATIONS` officer gets `checkIn` but not `publish`; a `VICE_LEAD` gets `publish` but **not** `checkIn`, which is the deliberate absence the matrix comments call out; and a plain member with an `EVENT_LEAD` assignment gets `attendees` and `checkIn` and nothing else, which is the whole point of per-event assignment.

`EventDetail.tsx` renders `publish` as a primary button and the rest as a row of outline controls, with `cancel` moved to the foot of the edit screen rather than the row. The club line becomes a `Link` to `/clubs/${event.clubSlug}`, and the comment above it explaining why it could not be one is deleted with it.

**Splitting `EventEditor`.** It is not a move. Those 576 lines already hold four things, and the split runs along the permission seam rather than down the middle:

| Goes to `/edit` | Goes to `/attendees` |
|---|---|
| `EventFields` and the save bar (`event:edit`) | the registration roster, `listRoster` (`registration:read`) |
| the poster upload (`event:edit`) | attendance and `correctAttendance` (`attendance:correct`) |
| publish and cancel (`event:publish`, `event:cancel`) | |
| the assignment roster (`event:assign`) | |

Assignments go with `edit`, not with `attendees`, because `event:assign` is `LEAD`/`VICE_LEAD`, the same audience as publish and cancel, whereas `registration:read` admits an `EVENT_LEAD` or `OPERATIONS` assignee who must reach the roster and nothing else. Putting assignments on the roster screen would hand the person who was just assigned the control that assigns people.

Each half keeps its own `useCursorPage` and its own loader; neither needs the other's state, which is why the file divides cleanly. Extract shared pieces only where both halves genuinely use them.

`events/[eventId]/check-in/page.tsx` renders `ScanSession` with the event already chosen. Delete its `clubId` prop, its `initialEvents`, its event picker and the `/events?clubId=` fetch that fed it. The forced-dark rule in `ConsoleFrame` keys off a path ending `/scan`; the new route ends `/check-in`, so move that decision onto the check-in page itself rather than leaving a path test that no longer matches anything.

- [ ] **Step 5: Run everything**

```bash
pnpm --filter @majlis/web test
pnpm build
```

Then restart `next dev` and walk it as three people: a plain student, a `CTO`, and a `LEAD`. The `CTO` is the case that catches a wrong gate, because they must see a club page with no Manage button at all and still reach Edit on their club's events.

Update `apps/web/e2e/attendance.spec.ts`, which drives the old `/manage/[clubId]/scan` route.

- [ ] **Step 6: Commit**

```bash
git add apps/web
git commit -m "feat(web): officer work moves onto the club and the event it concerns"
```

---

## Closing the stage

- [ ] Run `/code-review` and `/security-review` together, once, at the end. `/security-review` is not optional: this stage moves authorization-shaped decisions between files.
- [ ] Tick Stage 9 in spec §13 and record any deviation there.
- [ ] Use `superpowers:verification-before-completion` before claiming the stage is done.
- [ ] Use `superpowers:finishing-a-development-branch`.

## What this stage does not touch

- `(admin)/**` and the `/manage/[clubId]` console itself, beyond closing it to non-Admins.
- The permission matrix. Nothing here adds, removes or widens a permission.
- The carried security items earlier notes pencilled against "Stage 9": `__Host-` cookie prefixes, `helmet`, `Cache-Control` on API responses, and authorization refusals returning HTTP 200.
- Rate limiting, dropped from the build 2026-09-13.
