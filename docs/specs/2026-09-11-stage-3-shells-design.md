# Stage 3: design system and shells

**Status:** approved 2026-09-11. Binding for Stage 3.
Extends [`2026-09-10-majlis-design.md`](2026-09-10-majlis-design.md) §9. Where the two
disagree, the deviation is recorded in §10 here and in that document's §13.

---

## 1. Scope

Build `apps/web` from nothing: Next.js 16 App Router, the visual identity, the shadcn
component layer, the three shells, role routing, the PWA manifest, and a verified
accessibility baseline.

**In scope**

- Visual identity: palette, type ramp, tokens, dark mode, the component layer.
- Three shells with their chrome, navigation and layouts.
- Auth screens working end-to-end against the real API: sign in, sign up, sign out.
- `/` role redirect, `middleware.ts` gating, server-side re-verification in each layout.
- Every other route in §9.1 renders its shell plus a designed empty state.
- PWA manifest, icons, install-prompt service worker.
- Contrast, routing and API-client tests; Playwright + axe over the three shells.

**Out of scope:** everything that needs data Stage 3 does not have. No club, event,
membership, QR, certificate or notification screens beyond their empty states. **No fake
data anywhere**: a route with nothing behind it says so.

**Deferred with reasons**

| Deferred | Until | Why |
|---|---|---|
| TanStack Query | Stage 5 | Nothing in Stage 3 is optimistic or interactive enough to need a cache. Sign-in is one `fetch` and a redirect. |
| Generated OpenAPI client | Stage 9, or never | Needs handoff gap #5 (success-response schemas) fixed first. `@majlis/contracts` already is the typed source of truth. See §6. |
| Chart primitives | Stage 8 | The `dataviz` skill runs before the first chart, not now. |

---

## 2. Visual identity

Direction: **warm majlis**. A *majlis* is the room where a community sits together and
decides things. Warm earth ground rather than institutional blue-grey, a deep teal-green
that carries authority without borrowing the SaaS palette, and a mashrabiya-derived
lattice used as texture on three surfaces only.

Approved against a live identity board built from these exact values, judged in both
themes at working density on desktop and phone.

### 2.1 Palette

Every value below is shipped in `globals.css` and re-verified numerically by
`src/styles/tokens.contrast.test.ts` on every test run.

**Light, the default.** Light is the default because a student reads this outdoors in Gulf
sun. Chosen from the use scene, not from category habit.

| Token | Hex | Verified |
|---|---|---|
| `--color-bg` | `#FAF7F2` | ink 16.63:1 |
| `--color-surface` | `#FFFFFF` | ink 17.78:1 |
| `--color-surface-2` | `#F2EDE4` | ink 15.24:1 |
| `--color-ink` | `#1C1713` | 16.63:1 on bg |
| `--color-ink-2` | `#5B5045` | 7.34:1 on bg |
| `--color-ink-3` | `#7C6F62` | 4.56:1 on bg |
| `--color-border` | `#E3DACE` | dividers only |
| `--color-border-control` | `#90867A` | 3.06:1 worst ground |
| `--color-primary` | `#0E5F55` | 7.05:1 on bg |
| `--color-primary-hover` | `#0A4A42` | fg 10.14:1 |
| `--color-primary-fg` | `#FFFFFF` | 7.54:1 on primary |
| `--color-primary-soft` | `#DEEDE9` | fg 9.12:1 |
| `--color-primary-soft-fg` | `#0A443D` | |
| `--color-ok-soft` / `-fg` | `#DDEEDF` / `#14602F` | 6.33:1 |
| `--color-warn-soft` / `-fg` | `#FBEBCE` / `#7A4B06` | 6.30:1 |
| `--color-bad-soft` / `-fg` | `#F8DFDA` / `#98291F` | 6.20:1 |
| `--color-bad` | `#A33228` | 6.90:1 on surface |
| `--color-info-soft` / `-fg` | `#E1E6F2` / `#3A4A80` | 6.80:1 |
| `--color-mute-soft` / `-fg` | `#EDE7DD` / `#5B5045` | 6.38:1 |

**Dark, first-class and warm.** Built from warm browns, not a grey inversion. This is also
the theme the Stage 6 scanner will want at a dim door.

| Token | Hex | Verified |
|---|---|---|
| `--color-bg` | `#15110E` | ink 16.58:1 |
| `--color-surface` | `#1D1815` | ink 15.54:1 |
| `--color-surface-2` | `#251F1B` | ink 14.37:1 |
| `--color-ink` | `#F6F0E8` | 16.58:1 on bg |
| `--color-ink-2` | `#B6A899` | 8.09:1 on bg |
| `--color-ink-3` | `#948577` | 5.26:1 on bg |
| `--color-border` | `#372F28` | dividers only |
| `--color-border-control` | `#78675A` | 3.01:1 worst ground |
| `--color-primary` | `#5CC3AE` | 8.83:1 on bg |
| `--color-primary-hover` | `#7BD3C1` | fg 9.22:1 |
| `--color-primary-fg` | `#062520` | 7.63:1 on primary |
| `--color-primary-soft` | `#123830` | fg 8.11:1 |
| `--color-primary-soft-fg` | `#8EDCCB` | |
| `--color-ok-soft` / `-fg` | `#15321F` / `#82D497` | 7.83:1 |
| `--color-warn-soft` / `-fg` | `#3A2A0D` / `#EFBB63` | 7.88:1 |
| `--color-bad-soft` / `-fg` | `#3A1C18` / `#F0A197` | 7.54:1 |
| `--color-bad` | `#E2695C` | 5.37:1 on surface |
| `--color-info-soft` / `-fg` | `#1C2338` / `#A9B8E8` | 7.95:1 |
| `--color-mute-soft` / `-fg` | `#2A241F` / `#B6A899` | 6.60:1 |

**Two rules the token names carry structurally.**

`--color-border` is decorative and has no contrast requirement.
`--color-border-control` is the boundary of an input, checkbox or radio, is held to 3:1
against all three grounds, and is the **only** border token a form control may use. This
split exists because the first palette pass failed SC 1.4.11 at 1.79:1 in both themes.
The separate names make the requirement impossible to forget.

`--color-primary` is for primary actions, current selection, focus rings and state
indicators. **Never decoration.**

### 2.2 Type

**IBM Plex Sans** carries every label, button, table cell and paragraph. It is a humanist
face drawn alongside IBM Plex Sans Arabic, so the cultural root sits in the letterforms rather
than in decoration. **Fraunces** (`opsz` auto, weight 600) appears in exactly four places:
the wordmark, the login heading, page titles in the student shell, and empty-state
headlines. Never on a button, a label, a table cell or a number.

Both self-hosted via `next/font/google`, which emits `@font-face` with a real fallback
stack and removes the external stylesheet request. Fixed rem steps at a ~1.22 ratio, not
fluid: a clamp-sized heading that shrinks inside a sidebar looks worse, not better.

| Token | Size / line | Face |
|---|---|---|
| `--text-display` | 2.5rem / 1.05, `-0.022em` | Fraunces 600 |
| `--text-title` | 1.75rem / 1.15, `-0.018em` | Plex 600 |
| `--text-h1` | 1.375rem / 1.25, `-0.012em` | Plex 600 |
| `--text-h2` | 1.125rem / 1.35, `-0.006em` | Plex 600 |
| `--text-body` | 1rem / 1.5 | Plex 400 |
| `--text-sm` | 0.875rem / 1.45 | Plex 400 |
| `--text-label` | 0.75rem / 1.35, `+0.07em`, uppercase | Plex 600 |

Body base is 16px, not 15px: form inputs below 16px trigger iOS zoom-on-focus, and the
student shell is the primary surface. `font-variant-numeric: tabular-nums` on every
figure: counts, capacities, times, IDs, table numerics.

### 2.3 Other tokens

| Token | Value | Rule |
|---|---|---|
| `--radius-control` | 8px | Buttons, inputs, badges use `999px` |
| `--radius-card` | 12px | |
| `--radius-sheet` | 20px | Top corners only |
| `--shadow-sm` | `0 1px 2px /.06, 0 1px 1px /.04` | Offset **and** soft blur, always |
| `--shadow-md` | `0 4px 12px -2px /.10, 0 2px 4px -2px /.06` | |
| `--shadow-sheet` | `0 -8px 32px -8px /.18` | Bottom sheets |
| `--ease-out` | `cubic-bezier(.2,.8,.25,1)` | |
| `--dur-fast` / `--dur` | 160ms / 220ms | State and feedback only |
| `--space-safe-b` | `env(safe-area-inset-bottom)` | |

No zero-offset coloured halos. Under `prefers-reduced-motion: reduce`, `--dur-fast` and
`--dur` collapse to `0.01ms` at the token level, so it is enforced once rather than
remembered per component.

### 2.4 Motif and browser surfaces

The mashrabiya lattice is a CSS `repeating-linear-gradient` pair at 5% alpha tinted from
`--color-primary`. It appears on **three surfaces only**: the login/signup field, empty
states, and the QR pass card. Never behind body text. Zero dependencies, zero assets.

The QR pass is the student's identity object and the only surface that gets the full teal
field, the lattice and the display face together. Everything around it stays quiet so that
one card lands.

Text selection, the caret, the focus ring, scrollbars and numerals are all themed from the
palette rather than shipping browser defaults.

### 2.5 Naming

`lib/brand.ts` exports the product and company names. No component hardcodes "Majlis"; a
rename is one line. Spec §9.5.

---

## 3. Application structure

```
apps/web/
  app/
    layout.tsx                  html/body, fonts, theme script, <a href="#main"> skip link
    page.tsx                    "/" server-side role redirect, renders nothing
    (auth)/login|signup/        unauthenticated only; redirects away if signed in
    (student)/                  /home · /clubs · /events · /me · /me/qr
                                /me/registrations · /me/certificates
    (club)/manage/[clubId]/     overview · members · team · events · scan · certificates
    (admin)/admin/              metrics · users · departments · clubs · events · audit · exports
    verify/[code]/              public, no shell
  middleware.ts
  lib/
    brand.ts  api.ts  routing.ts  session.ts  theme.ts
  components/
    ui/                         shadcn primitives, re-pointed at our tokens
    shell/                      StudentShell · ConsoleShell · headers, nav, tab bar
    EmptyState.tsx  StatusBadge.tsx  Field.tsx  PageError.tsx
  styles/globals.css
```

Public discovery (`/clubs`, `/events`) lives inside the student shell rather than a
separate `(public)` group: Majlis is an authenticated product with no landing page, so
every viewer of those pages is signed in and gets the bottom tabs. `/verify/[code]` is the
one genuinely public route and has no shell at all. It is opened by an employer holding a
certificate, who has no account.

### 3.1 Student shell

A `100dvh` grid of three rows: sticky header, the single scrolling region, fixed tab bar.
`overscroll-behavior: contain` on the scroll region kills rubber-banding.
`env(safe-area-inset-top/bottom)` pads header and tab bar. Five equal tabs: Home, Clubs,
Events, My QR, Me, each a 64×56 target, above the 44px floor. Active tab carries colour,
weight **and** a 2px top indicator, so the state is never colour alone.

Events render as a **list with a date rail**, not a grid of identical cards. The date is
what a student scans for, and same-size icon-heading-text cards are the lazy container.

### 3.2 Console shells

Officer and admin share one `ConsoleShell` with different navigation, so the two never
read as different products. Sidebar on `--color-surface-2`, switcher at the top, content
on `--color-bg`. Collapses to a drawer below 1024px.

The officer console is addressed by club **ID** at `/manage/[clubId]`; public club pages
are addressed by **slug** at `/clubs/[slug]`. Spec §9.1: the collision is the reason.

Numbers sit in a horizontal stat strip, not four identical hero tiles. The figures support
the tables below; they are not the point of the page.

---

## 4. Auth and routing

### 4.1 The cookie path change

**Approved deviation from Stage 2.** `majlis_refresh` moves from `Path=/api/v1/auth` to
`Path=/`.

Session cookies live 15 minutes. With the refresh cookie scoped to `/api/v1/auth`, the
browser does not send it on a navigation to `/home`, so `middleware.ts` sees an anonymous
request and redirects a user who has 29 valid days remaining. The 30-day refresh token
would work only for XHR inside an already-live session, never for navigation.

With `Path=/`, middleware forwards the refresh cookie to `POST /api/v1/auth/refresh`, sets
the returned session cookie on its own response, and the navigation continues. No login
screen, no flash, no client round-trip.

Cost: the refresh token rides on every same-origin request rather than one path. It stays
`httpOnly`, `Secure`, `SameSite=Lax`, opaque, and stored only as a SHA-256 hash. The
change is one line in `apps/api/src/auth/cookies.ts` plus its tests. **It touches auth, so
`/security-review` runs before it lands.**

### 4.2 Routing rules

Pure functions in `lib/routing.ts`, unit-tested, with no framework imports:

```ts
landingFor(user: SessionUser): string
// ADMIN                       -> '/admin'
// officer of >=1 club, no ADMIN -> `/manage/${firstClubId}`   (sorted, deterministic)
// otherwise                   -> '/home'

decideRedirect(input: {
  pathname: string
  hasSession: boolean
  hasRefresh: boolean
}): { to: string } | null
```

`middleware.ts` gates on cookie presence only. It never decodes a token and never makes
an authorization decision. Each shell's `layout.tsx` then calls `GET /api/v1/auth/me`
server-side, re-derives club-scoped roles from that response, and redirects if the viewer
does not belong.

**Never render a page and then show an "authentication required" panel inside it.** Spec
§9.1. Layouts redirect before rendering.

A user who is both a student and an officer gets a shell switcher in the user menu.
`landingFor` sends them to the console because that is the role with work attached; the
switcher returns them to `/home`.

### 4.3 Sign-in flow

Login posts to `/api/v1/auth/login` from the client through the rewrite. Same origin, so
`Set-Cookie` lands in the browser directly with no CORS and no Server Action. The response
body is the `sessionUser`, and the client calls `router.replace(landingFor(user))`.

`next.config.ts` rewrites `/api/v1/:path*` to the API origin. This is what makes the
cookie first-party and removes CORS entirely.

---

## 5. Component layer

shadcn/ui primitives, installed as source, with their CSS variables **re-pointed at our
token names** rather than maintaining a parallel shadcn palette that drifts alongside ours.
Tailwind v4 reads the tokens out of `@theme` in `globals.css`.

Only the primitives Stage 3 actually uses get installed: `button`, `input`, `label`,
`sheet`, `dropdown-menu`, `avatar`, `skeleton`, `sonner`. Later stages install what they
need when they need it.

Every interactive component ships **default, hover, focus-visible, active, disabled,
loading and error**. Shipping half of these is shipping none.

Beyond shadcn, four components carry Majlis's own vocabulary:

- `StatusBadge`: the single renderer for every status enum in the schema. Always icon
  plus word; colour never carries meaning alone.
- `EmptyState`: display-face headline and the action that resolves it. No explanatory
  paragraph. No `description` prop exists, so one cannot be added by habit.
- `Field`: label, control, error. No description or helper slot. Errors are driven off
  the API's RFC 9457 `errors[]` array and wired with `aria-describedby` + `aria-invalid`.
- `PageError`: per-shell error boundary. Says the true thing in one line: no access,
  suspended, or genuinely broken. Spec §10.

### 5.1 Copy rule

**The interface guides through layout and affordance, not through prose.** Banned
outright: taglines, field helper text, empty-state explainer paragraphs, and
instructional microcopy ("tap to enlarge", "you can also…"). A headline plus the action
is enough; a button names its action and stops.

This is enforced structurally rather than by review. `EmptyState` and `Field` have no
prop to hang a description on.

Three things are **not** copy and stay:

- A visible `<label>` on every control, and an accessible name on every icon-only control.
- Error messages that name the problem **and** the recovery. A bare "Invalid" fails
  WCAG 3.3.3 and leaves the user stuck.
- The word inside a `StatusBadge`, because colour alone must never carry meaning.

Icons are `lucide-react`, one stroke weight throughout. No emoji standing in for an icon.

---

## 6. API client

`lib/api.ts` is a thin `fetch` wrapper, not a generated client.

- Same-origin through the rewrite; `credentials: 'same-origin'`.
- Non-2xx with `application/problem+json` parses into a typed `ProblemError` carrying
  `status`, `title`, `detail`, `requestId` and `errors[]`.
- On 401: call `POST /api/v1/auth/refresh` **once**, then retry the original request once.
  No client-side dedupe is needed: the refresh token does not rotate, so concurrent refreshes are
  harmless. A 401 on the refresh itself redirects to `/login`.
- Response types come from `@majlis/contracts` Zod schemas.

Spec §9.2 calls for "one generated typed client". **Deviation:** generation needs handoff
gap #5 fixed first (OpenAPI documents error shapes but no success-response schemas), plus
a generator dependency and a build step, all to arrive at types `@majlis/contracts` already
provides as the declared single source of truth. Revisit in Stage 9 if the surface grows
enough to earn it. Recorded in §10.

---

## 7. PWA

`manifest.webmanifest` with name from `lib/brand.ts`, `display: standalone`,
`start_url: '/'`, theme colour `#0E5F55`, and maskable icons at 192/512 generated from an
authored SVG mark. A service worker exists only because Chrome requires one with a `fetch`
handler to offer the install prompt. It is a pass-through and caches nothing.
**No offline support.** Spec §9.3.

---

## 8. Accessibility

WCAG 2.2 AA, verified rather than asserted. Spec §9.5.

- **Contrast:** `tokens.contrast.test.ts` computes WCAG relative luminance over the
  shipped hex values and asserts 4.5:1 on text pairs, 3:1 on control boundaries and focus
  rings. A palette regression fails the build. This suite already caught two real SC
  1.4.11 failures during design.
- **Keyboard:** visible `:focus-visible` on every interactive element, a skip link to
  `#main`, focus trapped and restored in sheets and dropdowns, logical tab order.
- **Colour alone:** `StatusBadge` always pairs colour with an icon and a word; the active
  tab carries an indicator bar as well as colour.
- **Forms:** every control has a real `<label>`; errors use `aria-describedby` and
  `aria-invalid` and are announced.
- **Motion:** `prefers-reduced-motion` collapses durations at the token level.
- **Landmarks:** one `<main id="main">`, `<nav>` with accessible names, one `<h1>` per
  page.

---

## 9. Testing

Spec §12's discrimination rule applies: before trusting a test, name the broken
implementation it would catch. If you cannot, it is not testing anything.

**Unit (Vitest)**

| Suite | Must catch |
|---|---|
| `tokens.contrast` | Any token edited below its threshold, in either theme |
| `routing.landingFor` | A user who is **both** ADMIN and officer (admin wins); an officer of two clubs (deterministic pick, not array order); a student with `clubRoles: []` |
| `routing.decideRedirect` | Signed-in user on `/login`; anonymous on `/home`; anonymous with refresh-only; `/verify/[code]` never gated |
| `api.client` | 401 → refresh → retry **once** and only once; a 401 on refresh redirecting rather than looping; a problem+json body parsing into `errors[]`; a non-JSON 500 not throwing a parse error |

A routing test written against a single-role user passes against an implementation that
ignores `platformRole` entirely. Every routing case uses a user whose roles conflict.

**E2E (Playwright + axe-core):** sign in as each seeded account and assert the landing
route; axe over login, student shell, officer console and admin dashboard, in **both
themes** at mobile and desktop viewports; keyboard-only path through sign-in; the
15-minute-idle refresh path with the session cookie cleared.

Playwright is due in Stage 9 regardless. Installing it now is what makes the accessibility
claim evidence instead of assertion.

---

## 10. Deviations from the master spec

Recorded here and in `2026-09-10-majlis-design.md` §13.

| # | §9 says | Stage 3 does | Why |
|---|---|---|---|
| 1 | "One generated typed client" | Thin `fetch` wrapper over `@majlis/contracts` | OpenAPI has no success-response schemas (handoff gap #5). Codegen would add a dependency and a build step to reach types contracts already declares. Revisit Stage 9. |
| 2 | `(public)` route group | Public discovery lives in the student shell | No landing page and no anonymous browsing, so every viewer is signed in. `/verify/[code]` remains genuinely public and shell-less. |
| 3 | `majlis_refresh` at `Path=/api/v1/auth` | `Path=/` | Middleware cannot otherwise see it; a valid 30-day session is bounced to `/login` after 15 idle minutes. §4.1. Security review before it lands. |
| 4 | TanStack Query for interactive surfaces | Not installed | Stage 3 has no interactive surface. Arrives in Stage 5 with registration. |
| 5 | `verify/[code]/` public route (§3) | Not built, deferred to Stage 7 | No certificate exists to verify until Stage 7 issues one, so the route could only ever 404. `decideRedirect` already leaves `/verify` ungated and is tested for it, so the gap is the page alone. |
| 6 | Console switcher "at the top of the sidebar" (§3.2) | In the header user menu instead | One switcher, reachable from every shell including the student one, which has no sidebar. A sidebar-only switcher is unreachable below 1024px until the drawer is opened, and the destinations belong beside the identity they are derived from. |

## 11. Open items

- **`landingFor` for a multi-club officer** picks the first club by sorted ID. Arbitrary
  but deterministic and testable. Stage 4 should replace it with most-recently-active once
  memberships carry timestamps worth sorting on.
- **No password reset or email verification** anywhere in the product (handoff gap #4).
  Stage 3 does not add one; the sign-in screen therefore has no "forgot password" link,
  which is a visible hole. Needs a product decision before Stage 8.
