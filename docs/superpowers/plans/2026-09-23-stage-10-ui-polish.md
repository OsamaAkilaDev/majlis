# Stage 10: UI polish and the certificate rule

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Nine corrections reported by the product owner after walking the student shell on a phone: a duplicated clubs list, missing back navigation, a discover list that shows clubs you already belong to, two confirmation dialogs that earn nothing, a notification you must dismiss twice, a date picker that overflows a phone, and a certificate toggle that can be switched on with nothing behind it.

**Architecture:** Eight of the nine are web-only and local to one or two components. The ninth, discover's filter, cannot be done in the browser: `clubSummarySchema` carries no viewer relationship and filtering a page client-side returns short pages, so it needs a query flag on `GET /clubs` and a field on the summary. That task is the only one touching `packages/contracts` and `apps/api`, and it is sequenced first so the web half has a real API to call.

**Tech Stack:** Next.js 16 (App Router, RSC), Tailwind v4, shadcn/ui, react-aria-components, Zod 4 contracts, NestJS 12, Prisma 7, Vitest, Playwright.

**Spec:** [`docs/specs/2026-09-10-majlis-design.md`](../../specs/2026-09-10-majlis-design.md). This plan introduces no architecture the spec does not already settle, so per §13's "How a stage is built" there is no separate stage design document; the decisions are recorded inline below and belong in §13 when the stage closes.

## Global Constraints

Copied verbatim from `CLAUDE.md` and the spec. Every task's requirements implicitly include this section.

- **No em dashes.** Not in chat, docs, commits, comments or UI copy.
- **No explanatory UI copy.** No taglines, helper text or empty-state explainers. Layout guides, not prose.
- **English only.** No localisation fields.
- **Server-side authorization on every protected endpoint.** Re-derive permissions from the database on every request. Never trust a client-supplied role, club ID, or ownership claim. Hiding a control in the UI is presentation, never protection.
- **Write through `TransactionHost`, never `PrismaService` directly.** `host.tx` returns the ambient transaction; `host.run(fn)` starts one or joins the caller's.
- **Services throw `DomainError` subclasses** (`NotFoundError`, `ForbiddenError`, `ConflictError`, `UnprocessableError`), never `@nestjs/common` exceptions.
- **OpenAPI is generated from code**, never hand-written. Zod schemas in `packages/contracts` are the single source of truth.
- **Write tests that discriminate.** Before trusting a test, name the broken implementation it would catch. If you cannot, it is not testing anything.
- **Every state transition goes through the entity's transition function.** No ad-hoc status writes.
- **`user` is a reserved word in Postgres.** Quote it in raw SQL.
- Branch is `stage-10-ui-polish`, already created off `main`. One commit per task.

## Decisions taken during brainstorming, 2026-09-23

Recorded here because this stage has no design document of its own.

1. **The profile loses both its clubs list and its invitations.** `/clubs` already lists the viewer's clubs, so the profile copy was duplication. Invitations move to `/clubs`, which is where you act on them.
2. **Back navigation appears on every screen except the three tab roots** (`/events`, `/clubs`, `/profile/qr`). Back from a tab root has nowhere to go. The one hand-rolled back link, in `clubs/[slug]/about/page.tsx`, is removed rather than left to double up.
3. **Discover hides clubs the viewer is `ACTIVE` or `PENDING` in, until they search.** A search shows them, marked `Joined`. `REJECTED`, `LEFT` and `REMOVED` do not hide a club: those are clubs you may legitimately want to join.
4. **Text selection is off application-wide, and back on for form fields and for values people copy**: the certificate code, the public verification code, and email addresses.
5. **Cancelling a registration loses its confirmation dialog** at both call sites. Registering again is one tap, so the dialog guards nothing expensive.
6. **A linked notification is marked read when it is opened.** The `Mark read` button stays on every row, including linked ones.
7. **Certificate fields become mandatory when certificates are enabled**, enforced by Zod on create and by the service on patch. No `CHECK` constraint and no migration: one existing event already violates the rule, and it stays editable until someone next saves it.

## File Structure

**Created**

| File | Responsibility |
|---|---|
| `apps/web/src/components/shell/BackButton.tsx` | The header back control. Client component; decides from the pathname whether it renders at all. |
| `apps/web/src/lib/back.ts` | `isTabRoot(pathname)`, the pure rule behind that decision. Unit tested. |
| `apps/web/src/lib/back.test.ts` | Tests for the above. |
| `packages/contracts/src/events/certificate-fields.ts` | `certificateFieldsComplete(row)`, the merged-row rule, imported by BOTH the web form and the API service. See ledger Ruling R2. |
| `packages/contracts/src/events/certificate-fields.test.ts` | Tests for the above. |

**Modified**

| File | Change |
|---|---|
| `packages/contracts/src/clubs/index.ts` | `joinable` flag on `clubListQuerySchema`; `viewerJoined` on `clubSummarySchema`. |
| `packages/contracts/src/events/index.ts` | `.check()` on `createEventBodySchema` for the certificate pair. |
| `apps/api/src/clubs/clubs.service.ts` | `list` honours `joinable`; `toClubSummary` carries `viewerJoined`. |
| `apps/api/src/events/events.service.ts` | `assertCertificateFields` on the merged row in `update`. |
| `apps/web/src/components/shell/StudentShell.tsx` | Renders `BackButton` before the title. |
| `apps/web/src/components/shell/ConsoleShell.tsx` | Same. |
| `apps/web/src/app/(student)/profile/page.tsx` | Drops `ProfileManager`. |
| `apps/web/src/app/(student)/profile/ProfileManager.tsx` | Deleted; its invitations half moves to `ClubGroups`. |
| `apps/web/src/app/(student)/clubs/page.tsx` | Fetches invitations; passes them down. |
| `apps/web/src/app/(student)/clubs/ClubGroups.tsx` | Invitations section; Browse button at the top; dashed row removed. |
| `apps/web/src/app/(student)/clubs/[slug]/about/page.tsx` | Hand-rolled back link removed. |
| `apps/web/src/app/(student)/clubs/discover/ClubBrowser.tsx` | Sends `joinable`; renders the `Joined` badge. |
| `apps/web/src/app/(student)/events/[eventId]/RegisterControl.tsx` | Cancel dialog removed. |
| `apps/web/src/app/(student)/profile/registrations/RegistrationsManager.tsx` | Cancel dialog removed. |
| `apps/web/src/app/(student)/profile/notifications/Inbox.tsx` | Opening a linked notification marks it read. |
| `apps/web/src/components/DateTimeRange.tsx` | Wrapping input row; popover fits a phone. |
| `apps/web/src/components/ScheduleTimeline.tsx` | No longer overflows at 320px. |
| `apps/web/src/app/(student)/events/[eventId]/EventDetail.tsx` | Two fixed `grid-cols-2` lists become responsive. |
| `apps/web/src/components/event/EventFields.tsx` | Certificate fields required when the toggle is on. |
| `apps/web/src/app/globals.css` | Application-wide `user-select: none` plus its exceptions. |

---

### Task 1: Discover hides clubs you are already in

The only task touching the API. Everything else is web-only, so this one goes first and unblocks Task 2's sibling.

**Files:**
- Modify: `packages/contracts/src/clubs/index.ts:116-126` (`clubSummarySchema`), `:159-163` (`clubListQuerySchema`)
- Modify: `apps/api/src/clubs/clubs.service.ts:71-83` (`toClubSummary`), `:235-261` (`list`)
- Test: `apps/api/test/clubs.integration.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `ClubListQuery.joinable?: boolean` and `ClubSummary.viewerJoined: boolean`, both consumed by Task 2's `ClubBrowser`.

- [ ] **Step 1: Write the failing integration test**

Add to `apps/api/test/clubs.integration.test.ts`. Read the file's existing helpers first and reuse its sign-in and seeding utilities rather than inventing new ones.

```ts
it('joinable hides the clubs the viewer is in or waiting on, and nothing else', async () => {
  // Discriminating: a filter keyed on "has any membership row" passes a test
  // written with one ACTIVE member and still hides a club the viewer LEFT,
  // which is a club they may well want to re-join. Each status is asserted on
  // its own, and the unfiltered list is asserted too, or a filter that hid
  // everything would pass.
  const viewer = await signInAsStudent();

  const active = await seedClub({ name: 'Active Club' });
  const pending = await seedClub({ name: 'Pending Club' });
  const left = await seedClub({ name: 'Left Club' });
  const untouched = await seedClub({ name: 'Untouched Club' });

  await seedMembership(active.id, viewer.id, 'ACTIVE');
  await seedMembership(pending.id, viewer.id, 'PENDING');
  await seedMembership(left.id, viewer.id, 'LEFT');

  const all = await get('/clubs?status=ACTIVE&limit=100', viewer);
  const names = (body: ClubPage) => body.items.map((c) => c.name);
  expect(names(all)).toEqual(expect.arrayContaining([
    'Active Club', 'Pending Club', 'Left Club', 'Untouched Club',
  ]));

  const joinable = await get('/clubs?status=ACTIVE&joinable=true&limit=100', viewer);
  expect(names(joinable)).toEqual(expect.arrayContaining(['Left Club', 'Untouched Club']));
  expect(names(joinable)).not.toContain('Active Club');
  expect(names(joinable)).not.toContain('Pending Club');
});

it('reports the viewer relationship on the summary, per viewer', async () => {
  // Discriminating: a mapper that read the first membership row regardless of
  // user would mark a club joined for a viewer who never joined it. Two
  // viewers, one club, opposite answers.
  const owner = await signInAsStudent();
  const stranger = await signInAsStudent({ email: 'stranger@uni.ac.ae' });
  const club = await seedClub({ name: 'One Club' });
  await seedMembership(club.id, owner.id, 'ACTIVE');

  const mine = await get('/clubs?status=ACTIVE&q=One Club', owner);
  expect(mine.items[0]!.viewerJoined).toBe(true);

  const theirs = await get('/clubs?status=ACTIVE&q=One Club', stranger);
  expect(theirs.items[0]!.viewerJoined).toBe(false);
});
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `cd apps/api && pnpm exec dotenv -e ../../.env -c -- vitest run --config vitest.integration.config.ts test/clubs.integration.test.ts -t joinable`

Expected: FAIL. The first on `joinable` being an unknown query key or simply ignored, the second on `viewerJoined` being `undefined`.

Note: per the project's `integration-env-mismatch` note, unrelated failures in this suite come from `.env` secrets rather than from code. Only the two tests above matter here.

- [ ] **Step 3: Extend the contracts**

In `packages/contracts/src/clubs/index.ts`, add to `clubSummarySchema`:

```ts
  /** The viewer's own relationship, reduced to the one bit a list needs: are
   *  they in this club or waiting on it. Never another user's. */
  viewerJoined: z.boolean(),
```

And to `clubListQuerySchema`:

```ts
  /** Hides the clubs the viewer is ACTIVE or PENDING in. Discover browses with
   *  it on and searches with it off, so a club you belong to is findable by
   *  name and absent from the browse list. */
  joinable: z.stringbool().optional(),
```

If `z.stringbool()` is not available in the pinned Zod 4 version, use the same coercion idiom the repo already uses for boolean query parameters. Grep `packages/contracts/src` for an existing boolean query key and copy it exactly rather than inventing a second spelling.

- [ ] **Step 4: Carry the flag through the service**

In `apps/api/src/clubs/clubs.service.ts`, change `toClubSummary` to take the bit:

```ts
function toClubSummary(
  row: ClubRow,
  departmentName: string,
  memberCount: number,
  viewerJoined: boolean,
): ClubSummary {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    category: row.category,
    logoUrl: row.logoUrl,
    status: row.status,
    membershipPolicy: row.membershipPolicy,
    departmentName,
    memberCount,
    viewerJoined,
  };
}
```

Fix the other call site at `:100` by passing whatever the detail mapper already knows about the viewer's membership, so a club the viewer is `ACTIVE` or `PENDING` in reports `true` there too.

In `list`, add the filter and the per-viewer include. `HELD` is the pair of statuses that hide a club:

```ts
const HELD = ['ACTIVE', 'PENDING'] as const;
```

```ts
    const where: Prisma.ClubWhereInput = {
      ...(query.departmentId ? { departmentId: query.departmentId } : {}),
      ...(status ? { status } : {}),
      ...(query.q ? { name: { contains: query.q, mode: 'insensitive' as const } } : {}),
      // Scoped to actor.id. Without that filter this hides every club that has
      // any member at all, which on a populated database is all of them.
      ...(query.joinable
        ? { memberships: { none: { userId: actor.id, status: { in: HELD } } } }
        : {}),
    };

    const rows = await this.host.tx.club.findMany({
      where,
      ...cursorArgs(query),
      include: {
        department: { select: { name: true } },
        _count: { select: { memberships: { where: ACTIVE_ONLY } } },
        // Existence only: one row is enough to answer the bit, and selecting
        // the whole membership would widen the payload for nothing.
        memberships: {
          where: { userId: actor.id, status: { in: HELD } },
          select: { id: true },
          take: 1,
        },
      },
    });

    const { items, nextCursor } = cursorPage(rows, query.limit);

    return {
      items: items.map((c) =>
        toClubSummary(c, c.department.name, c._count.memberships, c.memberships.length > 0),
      ),
      nextCursor,
    };
```

- [ ] **Step 5: Run the tests and watch them pass**

Run: `cd apps/api && pnpm exec dotenv -e ../../.env -c -- vitest run --config vitest.integration.config.ts test/clubs.integration.test.ts -t joinable`

Expected: PASS, both.

- [ ] **Step 6: Prove the filter discriminates**

Temporarily change the `joinable` clause to `{ memberships: { none: { status: { in: HELD } } } }`, dropping `userId`. Re-run. The first test must go red. Restore the `userId` filter and confirm green again. This is the defect the test exists to catch.

- [ ] **Step 7: Typecheck and commit**

```bash
pnpm typecheck
git add packages/contracts/src/clubs/index.ts apps/api/src/clubs/clubs.service.ts apps/api/test/clubs.integration.test.ts
git commit -m "feat(api): /clubs can hide the clubs the viewer already belongs to"
```

---

### Task 2: Clubs moves off the profile, invitations move onto Clubs

Covers decisions 1 and 3's web half, and the Browse button.

**Files:**
- Modify: `apps/web/src/app/(student)/profile/page.tsx`
- Delete: `apps/web/src/app/(student)/profile/ProfileManager.tsx`
- Modify: `apps/web/src/app/(student)/clubs/page.tsx`
- Modify: `apps/web/src/app/(student)/clubs/ClubGroups.tsx`
- Modify: `apps/web/src/app/(student)/clubs/discover/ClubBrowser.tsx`

**Interfaces:**
- Consumes: `ClubListQuery.joinable` and `ClubSummary.viewerJoined` from Task 1.
- Produces: nothing later tasks depend on.

- [ ] **Step 1: Move the invitations half into ClubGroups**

Read `ProfileManager.tsx` completely before deleting anything. Its invitations section, its `act` helper and its accept/decline wiring move to `ClubGroups.tsx` verbatim, keeping the `showInvitations` rule that a `null` list still renders the skeleton and only a loaded, empty list drops the section. `ClubGroups` already owns the clubs half, so only the invitations half moves.

`apps/web/src/app/(student)/clubs/page.tsx` fetches the second list:

```tsx
  const [clubs, invitations] = await Promise.all([
    serverFetch<MyClubPage>(`/me/clubs?limit=${PAGE}`),
    serverFetch<InvitationPage>(`/me/invitations?limit=${PAGE}`),
  ]);

  return (
    <StudentShell title="Clubs" action={<SearchLink href="/clubs/discover" label="Find a club" />}>
      <ClubGroups initial={clubs} initialInvitations={invitations?.items ?? null} />
    </StudentShell>
  );
```

- [ ] **Step 2: Strip the profile**

In `apps/web/src/app/(student)/profile/page.tsx`, remove the `ProfileManager` element, its import, and the now-unused `clubs` and `invitations` fetches from the `Promise.all`. Leave `registrations` and `certificates`: the two tiles still count them. Remove `MyClubPage` and `InvitationPage` from the type import. Delete `ProfileManager.tsx`.

- [ ] **Step 3: Move the Browse control to the top and shrink it**

In `ClubGroups.tsx`, delete the full-width dashed `Link` at the bottom (currently around `:114-120`). Put a compact control above the list instead:

```tsx
<Button asChild variant="outline" size="sm" className="self-start">
  <Link href="/clubs/discover">Browse clubs</Link>
</Button>
```

The header's `Find a club` search icon stays. Keep the empty-state link in the clubs section pointing at `/clubs/discover`, since with no clubs the list itself is empty.

- [ ] **Step 4: Teach discover the filter and the badge**

In `ClubBrowser.tsx`, send `joinable` only when there is no search term, and mark the ones that come back joined:

```tsx
// Browsing shows what you could join; searching shows everything, because a
// club you are in is exactly the thing you would search by name for.
const params = { limit: PAGE, ...(q ? { q } : { joinable: true }), ...rest };
```

Render `viewerJoined` with the existing badge component the file already imports, not a bare coloured span. Grep the file for `StatusBadge` or its sibling and match how the rest of the screen labels state. The label is the single word `Joined`.

- [ ] **Step 5: Verify by hand**

Run `pnpm --filter @majlis/web dev` and check, signed in as a student who belongs to at least one club:

1. `/profile` shows no clubs and no invitations, and its two tiles still count.
2. `/clubs` shows invitations above your clubs, and a small `Browse clubs` button at the top.
3. `/clubs/discover` does not list a club you belong to.
4. Searching that club's name finds it, marked `Joined`.

- [ ] **Step 6: Typecheck, lint and commit**

```bash
pnpm --filter @majlis/web typecheck && pnpm --filter @majlis/web lint
git add -A
git commit -m "refactor(web): clubs and invitations live on the Clubs tab, not the profile"
```

---

### Task 3: A back button in every header that should have one

**Files:**
- Create: `apps/web/src/lib/back.ts`, `apps/web/src/lib/back.test.ts`, `apps/web/src/components/shell/BackButton.tsx`
- Modify: `apps/web/src/components/shell/StudentShell.tsx:29-38`, `apps/web/src/components/shell/ConsoleShell.tsx:19-24`
- Modify: `apps/web/src/app/(student)/clubs/[slug]/about/page.tsx:25-32`

**Interfaces:**
- Consumes: nothing.
- Produces: `isTabRoot(pathname: string): boolean` from `@/lib/back`; `<BackButton />` from `@/components/shell/BackButton`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/lib/back.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { isTabRoot } from './back';

describe('isTabRoot', () => {
  it('names the three roots the dock can reach', () => {
    // Back from a tab root leaves the app, so these are the screens that must
    // not render the control.
    expect(isTabRoot('/events')).toBe(true);
    expect(isTabRoot('/clubs')).toBe(true);
    expect(isTabRoot('/profile/qr')).toBe(true);
  });

  it('does not mistake a child for its root', () => {
    // The discriminating case. A startsWith test passes every assertion above
    // and then silently drops the back button from every detail screen in the
    // app, which is the whole feature.
    expect(isTabRoot('/events/discover')).toBe(false);
    expect(isTabRoot('/events/abc-123')).toBe(false);
    expect(isTabRoot('/clubs/discover')).toBe(false);
    expect(isTabRoot('/clubs/robotics-club')).toBe(false);
    expect(isTabRoot('/profile')).toBe(false);
    expect(isTabRoot('/profile/registrations')).toBe(false);
  });

  it('ignores a trailing slash', () => {
    // Next does not produce one, but a pathname arriving with it must not turn
    // a tab root into a screen with a back button that exits the app.
    expect(isTabRoot('/clubs/')).toBe(true);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd apps/web && pnpm vitest run --config vitest.config.ts src/lib/back.test.ts`

Expected: FAIL, "Cannot find module './back'". Write the module as a stub returning `false` and re-run so the failures become assertion failures before implementing.

- [ ] **Step 3: Implement**

Create `apps/web/src/lib/back.ts`:

```ts
import { STUDENT_TABS } from '@/components/shell/student-nav';

/**
 * The dock's own destinations, and the only screens with no back. Derived from
 * STUDENT_TABS rather than restated, so adding a tab cannot leave a back button
 * on it that walks the viewer out of the app.
 */
export function isTabRoot(pathname: string): boolean {
  const path = pathname.length > 1 ? pathname.replace(/\/$/, '') : pathname;
  return STUDENT_TABS.some((tab) => tab.href === path);
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `cd apps/web && pnpm vitest run --config vitest.config.ts src/lib/back.test.ts`

Expected: PASS, three tests.

- [ ] **Step 5: Prove the test discriminates**

Change the comparison to `path.startsWith(tab.href)` and re-run. The second test must go red on `/events/discover`. Restore `===` and confirm green.

- [ ] **Step 6: Build the control**

Create `apps/web/src/components/shell/BackButton.tsx`:

```tsx
'use client';

import { CaretLeft } from '@phosphor-icons/react';
import { usePathname, useRouter } from 'next/navigation';
import { ICON_WEIGHT } from '@/lib/icons';
import { isTabRoot } from '@/lib/back';

/**
 * Renders nothing on the three tab roots, where back would leave the app.
 *
 * `router.back()` rather than a computed parent href: the viewer's own history
 * is what they mean by back, and a hierarchy link sends someone who arrived at
 * an event from the inbox to a club they were never looking at.
 */
export function BackButton() {
  const pathname = usePathname();
  const router = useRouter();

  if (isTabRoot(pathname)) return null;

  return (
    <button
      type="button"
      onClick={() => router.back()}
      aria-label="Back"
      className="-ml-2 grid size-11 shrink-0 place-items-center rounded-control text-ink-2 hover:bg-surface-2 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
    >
      <CaretLeft size={20} weight={ICON_WEIGHT} aria-hidden />
    </button>
  );
}
```

The `size-11` is 44px, the touch target the rest of the shell uses. Check `StudentShell`'s existing controls and match them if they differ.

- [ ] **Step 7: Put it in both headers**

In `StudentShell.tsx`, render it as the first child of `<header>`, before the `<h1>`. In `ConsoleShell.tsx`, the same, noting that its header already carries `pl-14` to clear the sidebar trigger on mobile; place the button so the two do not collide, reducing the padding if the button now occupies that space.

- [ ] **Step 8: Remove the duplicate**

In `apps/web/src/app/(student)/clubs/[slug]/about/page.tsx`, delete the hand-rolled `Link` back to the club and its now-unused `CaretLeft` and `ICON_WEIGHT` imports. This is the only such link in the codebase; confirm with `grep -rn "CaretLeft" apps/web/src/app` before and after, and expect `DateTimeRange.tsx` to remain as the only other user.

- [ ] **Step 9: Verify by hand**

With the dev server running: no back button on `/events`, `/clubs`, `/profile/qr`. One, and exactly one, on `/profile`, `/clubs/discover`, a club page, a club's About page, an event page, and an admin console screen. Pressing it returns to the previous screen.

- [ ] **Step 10: Typecheck, lint and commit**

```bash
pnpm --filter @majlis/web typecheck && pnpm --filter @majlis/web lint && pnpm --filter @majlis/web test
git add -A
git commit -m "feat(web): every screen but a tab root carries a back button"
```

---

### Task 4: Cancelling a registration stops asking twice

**Files:**
- Modify: `apps/web/src/app/(student)/events/[eventId]/RegisterControl.tsx:98-110`
- Modify: `apps/web/src/app/(student)/profile/registrations/RegistrationsManager.tsx:96-110`

**Interfaces:** none.

- [ ] **Step 1: Replace the dialog on the event page**

In `RegisterControl.tsx`, the `action.kind === 'cancel'` branch becomes the button alone:

```tsx
      {action.kind === 'cancel' ? (
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => run(() => cancelRegistration(event.id))}
        >
          Cancel registration
        </Button>
      ) : null}
```

- [ ] **Step 2: Replace the dialog in the list**

In `RegistrationsManager.tsx`, the `ConfirmDialog` wrapping the `Cancel` trigger becomes that trigger, with `onClick={() => cancel(registration)}` moved onto it and the same `disabled` condition the trigger already carried.

- [ ] **Step 3: Drop dead imports**

Remove the `ConfirmDialog` import from both files. Leave every other `ConfirmDialog` in the codebase alone: leaving a club, revoking a certificate, deleting a department and cancelling an event all keep theirs, and only registration was named.

- [ ] **Step 4: Verify by hand**

Register for an event, cancel from the event page, and confirm it cancels in one press with no dialog. Do the same from `/profile/registrations`. Confirm leaving a club from `/clubs` still asks.

- [ ] **Step 5: Typecheck, lint and commit**

```bash
pnpm --filter @majlis/web typecheck && pnpm --filter @majlis/web lint
git add -A
git commit -m "fix(web): cancelling a registration takes one press"
```

---

### Task 5: Opening a notification marks it read

**Files:**
- Modify: `apps/web/src/app/(student)/profile/notifications/Inbox.tsx:136-159`

**Interfaces:** none.

- [ ] **Step 1: Mark on open**

The title's `Link` gains the same call the button makes. `markRead` already updates optimistically and restores the previous list on failure, so it is reused rather than reimplemented, and it must not be awaited before navigation: the viewer should not wait on a write to follow a link.

```tsx
                      {href ? (
                        <Link
                          href={href}
                          className="hover:underline"
                          // Not awaited: the navigation is the point, and the
                          // read is optimistic anyway. Only for an unread row,
                          // or every revisit writes again.
                          onClick={() => {
                            if (unread) void markRead(notification);
                          }}
                        >
                          {title}
                        </Link>
                      ) : (
                        title
                      )}
```

- [ ] **Step 2: Leave the button alone**

The `Mark read` button stays on every unread row, linked or not. It is the only way to clear a notification that links nowhere, and on a linked one it lets the viewer clear without opening.

- [ ] **Step 3: Verify by hand**

With at least one unread linked notification: open `/profile/notifications`, press the title, land on the target, return, and confirm the row is read and the unread count in the header bell has dropped. Confirm an unread row with no link still shows the button and still clears with it.

- [ ] **Step 4: Typecheck, lint and commit**

```bash
pnpm --filter @majlis/web typecheck && pnpm --filter @majlis/web lint
git add -A
git commit -m "fix(web): opening a notification marks it read"
```

---

### Task 6: The date range picker fits a phone

The reported overflow is two things: the input row, which puts two full dates, a separator and a button on one line that never wraps, and `ScheduleTimeline` beneath it, whose bar labels are `whitespace-nowrap` inside absolutely positioned bars.

**Files:**
- Modify: `apps/web/src/components/DateTimeRange.tsx:128-147` (the `Group`), `:158-202` (the `Popover`)
- Modify: `apps/web/src/components/ScheduleTimeline.tsx:54-75`
- Modify: `apps/web/src/app/(student)/events/[eventId]/EventDetail.tsx:163`, `:188`

**Interfaces:** none.

- [ ] **Step 1: Reproduce it first**

Do not change anything yet. Run the dev server, open `/clubs/<a club you lead>/events/new` in a phone viewport at 320px wide (Chrome DevTools, iPhone SE), and note exactly what overflows: the input row, the popover, the timeline, or all three. Write the list down. The fix is judged against it, and a fix aimed at the wrong element is the common failure here.

- [ ] **Step 2: Let the input row wrap**

The `Group` at `:128` gets `flex-wrap` and its two `DateInput`s stop being forced onto one line. The separator is hidden once wrapped, since a dash between two stacked rows reads as a minus sign. The calendar button keeps `ml-auto` and `shrink-0`:

```tsx
<Group className="flex min-h-10 flex-wrap items-center gap-x-2 gap-y-1 rounded-control border border-border-control bg-surface px-2.5 py-1.5 focus-within:border-primary focus-within:ring-3 focus-within:ring-primary-soft data-[invalid]:border-bad data-[invalid]:focus-within:ring-bad-soft data-disabled:opacity-50">
```

Keep every state variant in that string exactly as it is. Only the layout classes change.

- [ ] **Step 3: Make the popover fit**

The `Popover` at `:158` has no width bound, so the calendar can exceed a 320px viewport. Constrain it and let the calendar breathe:

```tsx
<Popover className="w-[min(20rem,calc(100vw-2rem))] max-w-[calc(100vw-2rem)] rounded-card border border-border bg-surface p-3 shadow-[var(--shadow-md)]">
```

The `grid grid-cols-2` holding the two `Clock`s at `:199` becomes `grid-cols-1 gap-2 sm:grid-cols-2`, so the two time fields stack rather than halve at phone width.

- [ ] **Step 4: Stop the timeline overflowing**

In `ScheduleTimeline.tsx`, the row at `:55` puts two `tabular-nums` edge labels at opposite ends of a flex row with no wrapping; at 320px with a long date these collide. Give that row `gap-2` and let the labels truncate rather than push. The bar labels inside the absolutely positioned elements at `:70-71` already carry `overflow-hidden`, so confirm the bar itself cannot exceed its track before changing them, and leave them alone if it cannot.

- [ ] **Step 5: Make the event page lists responsive**

In `EventDetail.tsx`, both `<dl>` elements become `grid-cols-1 gap-3 sm:grid-cols-2`. The `Fact` components carrying `span` already cross both columns, so they are unaffected at `sm` and up.

- [ ] **Step 6: Verify against the list from Step 1**

At 320px, then 390px, then 768px: no horizontal scrollbar on the event form, the picker's popover opens fully within the viewport, both clocks are reachable, the timeline does not overflow, and the event page's facts read one per row on a phone. Check the whole create-event flow end to end on the phone viewport, not just the picker: the reporter asked for the experience, not one component.

- [ ] **Step 7: Typecheck, lint and commit**

```bash
pnpm --filter @majlis/web typecheck && pnpm --filter @majlis/web lint
git add -A
git commit -m "fix(web): the date range picker and the schedule timeline fit a phone"
```

---

### Task 7: Text stops being selectable, except where it must not

**Files:**
- Modify: `apps/web/src/app/globals.css`

**Interfaces:** none.

- [ ] **Step 1: Find the copyable values first**

Before writing any CSS, list the places a viewer genuinely needs to copy text. Grep for the certificate code and the public verification code:

```bash
grep -rn "code" apps/web/src/app/\(public\)/verify/ apps/web/src/app/\(student\)/profile/certificates/ --include=*.tsx | head -20
```

Anything rendering a certificate code, a verification code, or an email address is an exception. Write the list down; Step 2 depends on it.

- [ ] **Step 2: Add the rule and its exceptions**

In `globals.css`:

```css
/* The student shell is meant to read as an application, not a page: a long
   press on a label should not raise a selection handle. Inputs are exempt
   because selecting inside one is how you edit it, and `.selectable` is for
   the values a viewer has a real reason to copy. */
body {
  -webkit-user-select: none;
  user-select: none;
}

input,
textarea,
[contenteditable='true'],
.selectable {
  -webkit-user-select: text;
  user-select: text;
}
```

`-webkit-user-select` is kept beside the standard property: Safari on iOS is the browser this rule is most for, and it is the one that still wants the prefix.

- [ ] **Step 3: Mark the exceptions**

Add `className="selectable"` to each element from Step 1's list. At minimum the certificate code on `/profile/certificates`, the code on the public `/verify/[code]` page, and the viewer's email on `/profile`.

- [ ] **Step 4: Verify by hand**

On a phone viewport: a long press on a club name, a heading or a button raises no selection. A certificate code can still be selected and copied. Typing in the event form's fields still works, including selecting a word and replacing it. Check the officer console too, since `body` covers all three shells.

- [ ] **Step 5: Typecheck, lint and commit**

```bash
pnpm --filter @majlis/web typecheck && pnpm --filter @majlis/web lint
git add -A
git commit -m "feat(web): text is not selectable outside fields and copyable codes"
```

---

### Task 8: A certificate cannot be enabled with nothing behind it

**Files:**
- Create: `packages/contracts/src/events/certificate-fields.ts`, `packages/contracts/src/events/certificate-fields.test.ts`
- Modify: `packages/contracts/src/events/index.ts:63-65`
- Modify: `apps/api/src/events/events.service.ts:108-116` (beside `assertWindows`), `:455-460` (the merge in `update`)
- Modify: `apps/web/src/components/event/EventFields.tsx`
- Test: `apps/api/test/events.integration.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `certificateFieldsComplete(row: { certificateEnabled: boolean; certificateTitle: string | null; certificateSignatory: string | null }): boolean`, used by the web form.

- [ ] **Step 1: Write the failing web test**

Create `packages/contracts/src/events/certificate-fields.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { certificateFieldsComplete } from './certificate-fields';

const off = { certificateEnabled: false, certificateTitle: null, certificateSignatory: null };

describe('certificateFieldsComplete', () => {
  it('asks for nothing while certificates are off', () => {
    expect(certificateFieldsComplete(off)).toBe(true);
    // Still complete with a leftover title: turning the toggle off does not
    // make the stored text a problem, and refusing the save would trap an
    // officer who only wanted to switch certificates off.
    expect(certificateFieldsComplete({ ...off, certificateTitle: 'Old title' })).toBe(true);
  });

  it('needs both fields once certificates are on', () => {
    // Discriminating: a rule checking only the title accepts an enabled
    // certificate with no signatory, which renders a document signed by
    // nobody. Each half is asserted missing on its own.
    const on = { ...off, certificateEnabled: true };
    expect(certificateFieldsComplete(on)).toBe(false);
    expect(certificateFieldsComplete({ ...on, certificateTitle: 'A' })).toBe(false);
    expect(certificateFieldsComplete({ ...on, certificateSignatory: 'B' })).toBe(false);
    expect(certificateFieldsComplete({ ...on, certificateTitle: 'A', certificateSignatory: 'B' })).toBe(true);
  });

  it('does not count whitespace as a value', () => {
    // A trimmed empty string reaches the PDF as a blank line where a name
    // belongs, and `!== null` would accept it.
    const on = { certificateEnabled: true, certificateTitle: '   ', certificateSignatory: 'B' };
    expect(certificateFieldsComplete(on)).toBe(false);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd packages/contracts && pnpm test`

Expected: FAIL, module not found. Stub it returning `true`, re-run, and confirm the second and third tests fail on assertions before implementing.

- [ ] **Step 3: Implement**

Create `packages/contracts/src/events/certificate-fields.ts`, exported from the package index beside the event schemas:

```ts
/**
 * A certificate needs a title and a signatory or it renders a document signed
 * by nobody. Applied to the merged row, never to the patch alone: a patch that
 * only flips the toggle on carries neither field and is still valid if the
 * stored row already has both.
 */
export function certificateFieldsComplete(row: {
  certificateEnabled: boolean;
  certificateTitle: string | null;
  certificateSignatory: string | null;
}): boolean {
  if (!row.certificateEnabled) return true;
  return Boolean(row.certificateTitle?.trim() && row.certificateSignatory?.trim());
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `cd packages/contracts && pnpm test`

Expected: PASS, three tests.

- [ ] **Step 5: Add the create-time rule to the contract**

In `packages/contracts/src/events/index.ts`, attach the rule to `createEventBodySchema`. Use whichever of `.check()`, `.superRefine()` or `.refine()` the file's other cross-field rules already use, and match them; grep the file for an existing multi-field validation before choosing. The error must be attached to the two field paths so the form can show it inline, not to the object root:

```ts
  .check((ctx) => {
    if (!ctx.value.certificateEnabled) return;
    for (const key of ['certificateTitle', 'certificateSignatory'] as const) {
      if (!ctx.value[key]?.trim()) {
        ctx.issues.push({
          code: 'custom',
          path: [key],
          input: ctx.value[key],
          message: 'Required when certificates are enabled.',
        });
      }
    }
  });
```

Leave `patchEventBodySchema` alone. It is `.partial()`, and a patch carrying only `certificateEnabled: true` is valid against the stored row when that row already has both fields, which a schema cannot know.

- [ ] **Step 6: Write the failing integration test for patch**

Add to `apps/api/test/events.integration.test.ts`, reusing its existing helpers:

```ts
it('refuses to enable certificates on an event that has no certificate fields', async () => {
  // The case Zod cannot reach: the patch body is valid on its own and only
  // becomes wrong when merged with the stored row. A rule living only in the
  // contract passes every schema test and lets this through.
  const officer = await signInAsLead();
  const event = await seedEvent({ certificateEnabled: false, certificateTitle: null, certificateSignatory: null });

  const refused = await patch(`/events/${event.id}`, { certificateEnabled: true }, officer);
  expect(refused.status).toBe(422);
  expect(refused.body.detail).toContain('certificate');

  const accepted = await patch(
    `/events/${event.id}`,
    { certificateEnabled: true, certificateTitle: 'Certificate of Attendance', certificateSignatory: 'Head of Engineering' },
    officer,
  );
  expect(accepted.status).toBe(200);
});

it('lets a patch flip the toggle when the stored row already carries both fields', async () => {
  // The other half. A rule reading the patch alone rejects this, which would
  // make certificates impossible to re-enable without retyping both fields.
  const officer = await signInAsLead();
  const event = await seedEvent({
    certificateEnabled: false,
    certificateTitle: 'Certificate of Attendance',
    certificateSignatory: 'Head of Engineering',
  });

  const res = await patch(`/events/${event.id}`, { certificateEnabled: true }, officer);
  expect(res.status).toBe(200);
});
```

- [ ] **Step 7: Run them and watch them fail**

Run: `cd apps/api && pnpm exec dotenv -e ../../.env -c -- vitest run --config vitest.integration.config.ts test/events.integration.test.ts -t certificate`

Expected: FAIL. The first because the patch is accepted with a 200.

- [ ] **Step 8: Add the service rule**

In `apps/api/src/events/events.service.ts`, beside `assertWindows` at `:108`, following its comment style and its `UnprocessableError`:

```ts
/**
 * Applied to the merged row for the same reason as assertWindows: a patch
 * carrying one half of the pair is checked against the stored other half. A
 * certificate with no title or no signatory renders a document signed by
 * nobody, and Certificate's snapshot columns mean that document then outlives
 * any later correction.
 */
function assertCertificateFields(row: {
  certificateEnabled: boolean;
  certificateTitle: string | null;
  certificateSignatory: string | null;
}): void {
  // The rule itself lives in @majlis/contracts so the form and this service
  // cannot drift. This only turns a false into a message, exactly as
  // assertWindows turns a comparison into one.
  if (certificateFieldsComplete(row)) return;
  throw new UnprocessableError(
    'A certificate needs a title and a signatory before it can be enabled.',
  );
}
```

In `update`, beside the existing `assertWindows` call, merge patch over stored row exactly as `at()` does for the windows:

```ts
      const merged = <K extends 'certificateEnabled' | 'certificateTitle' | 'certificateSignatory'>(
        key: K,
      ) => (data[key] === undefined ? event[key] : (data[key] as (typeof event)[K]));

      assertCertificateFields({
        certificateEnabled: merged('certificateEnabled'),
        certificateTitle: merged('certificateTitle'),
        certificateSignatory: merged('certificateSignatory'),
      });
```

Call `assertCertificateFields` in `create` too, on `body`, so the rule holds even if a caller reaches the service past the contract.

- [ ] **Step 9: Run them and watch them pass**

Run: `cd apps/api && pnpm exec dotenv -e ../../.env -c -- vitest run --config vitest.integration.config.ts test/events.integration.test.ts -t certificate`

Expected: PASS, both.

- [ ] **Step 10: Make the form say so before the round trip**

In `EventFields.tsx`, the two certificate inputs become required while the toggle is on. Mark them required for assistive technology as well as visually, and disable the submit button, or surface the inline error, in whichever way the form already handles a blocked save; grep the file for its existing `disabled` and error wiring and follow it rather than adding a second mechanism. Import `certificateFieldsComplete` from `@majlis/contracts` and use it as the condition. Add no helper text: per the project's copy rule, the required marker and the field label carry it.

- [ ] **Step 11: Verify by hand**

Create an event, enable certificates, leave the title blank, and confirm the form refuses before a request is sent. Fill both and confirm it saves. Edit an existing event that already has both fields, toggle certificates off and on, and confirm it saves without retyping.

- [ ] **Step 12: Typecheck, lint and commit**

```bash
pnpm typecheck && pnpm lint && pnpm --filter @majlis/web test
git add -A
git commit -m "feat: a certificate needs a title and a signatory before it can be enabled"
```

---

### Task 9: Close the stage

**Files:**
- Modify: `docs/specs/2026-09-10-majlis-design.md` (§13)
- Modify: `apps/web/e2e/attendance.spec.ts` and any other e2e touching a changed screen

**Interfaces:** none.

- [ ] **Step 1: Find the e2e that these changes broke**

Several specs walk screens this stage changed. The removal of the profile's clubs list, the new back button, and the cancel dialogs are the three most likely to have broken a selector. Grep for the affected text:

```bash
grep -rn "My clubs\|Browse all clubs\|Cancel registration\|Mark read" apps/web/e2e/
```

Update each hit to match the new UI. Note that the e2e suite cannot run against the current development database, which no longer holds its seed personas; the `e2e-seed-personas-missing` note covers this. Update the specs to match the new UI regardless, and say plainly in the commit message that they are unexercised.

- [ ] **Step 2: Record the stage in §13**

Add a row to the stage table and a dated note below it, following the format of the existing notes. The note records the seven decisions from this plan's "Decisions taken during brainstorming" section, in prose, with the reasoning. Record explicitly that the certificate rule was not given a `CHECK` constraint, that one existing event violates it, and that this was a deliberate choice rather than an oversight.

- [ ] **Step 3: Full verification**

```bash
pnpm typecheck && pnpm lint && pnpm test
cd apps/web && API_ORIGIN=http://localhost:3001 pnpm build
```

All four must pass. Report the actual output; do not summarise a run you did not make.

- [ ] **Step 4: Commit and push**

```bash
git add -A
git commit -m "docs(spec): Stage 10 is done, seven decisions recorded"
git push -u origin stage-10-ui-polish
```

---

## Self-Review

**Spec coverage.** Nine reported items, nine covered: profile clubs (Task 2), back button (Task 3), browse button (Task 2), discover filter (Tasks 1 and 2), text selection (Task 7), cancel dialog (Task 4), notification read (Task 5), mobile date section (Task 6), certificate fields (Task 8). Task 9 closes the stage.

**Sequencing.** Task 1 is first because Task 2 consumes its two new contract fields. Tasks 3 through 8 are mutually independent and could be done in any order or in parallel. Task 9 is last because it records what the others did.

**Known gaps, stated rather than hidden.**

- Task 6 has no automated test. The defect is visual overflow at a given viewport width, and this repository has no visual regression tooling; adding some for one task would be a larger change than the task. Its verification is a hand check against a list written before the fix, which is why Step 1 exists.
- Task 7 likewise. `user-select` has no meaningful unit test, and its risk is a missed exception rather than a wrong rule, which only a hand check finds.
- The e2e suite cannot be run to completion in the current environment. Task 9 updates it blind, which is stated in the task and must be stated in the commit.
