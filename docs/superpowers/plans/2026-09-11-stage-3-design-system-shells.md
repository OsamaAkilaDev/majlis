# Stage 3 implementation plan: design system and shells

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `apps/web` from nothing: Next.js 16 App Router, the Majlis visual identity, the shadcn component layer, three role-based shells, working sign-in, the PWA manifest, and a verified WCAG 2.2 AA baseline.

**Architecture:** A new pnpm workspace package `@majlis/web` alongside `@majlis/api`. Tailwind v4 reads design tokens from `globals.css`; shadcn primitives are re-pointed at those same token names so there is one palette, not two. A Next.js rewrite maps `/api/v1/*` to the API so the browser sees one origin and the session cookie is first-party. `middleware.ts` gates cheaply on cookie presence using pure, unit-tested rule functions, and refreshes an expired session in place; each shell's `layout.tsx` then re-verifies the real user server-side and redirects if they do not belong.

**Tech Stack:** Next.js 16.3.4, React 19.3.0, Tailwind CSS 4.3.3, shadcn/ui, next-themes, lucide-react, sonner, Vitest 5, Playwright 1.63 with axe-core.

**Spec:** [`docs/specs/2026-09-11-stage-3-shells-design.md`](../../specs/2026-09-11-stage-3-shells-design.md). Read it before Task 1. The master spec is [`docs/specs/2026-09-10-majlis-design.md`](../../specs/2026-09-10-majlis-design.md) §9.

---

## Global Constraints

Every task's requirements implicitly include this section.

**Toolchain traps (verified, each cost a session to discover)**

- `pnpm` 11 refuses any package published in the last 24 hours. Every version in this plan was verified to exist on npm and to be older than 48 hours as of 2026-09-11. Do not bump one without re-checking. Never add `minimumReleaseAgeExclude`.
- `@nestjs/cli` is deliberately absent from this repo. Nothing in this plan needs it.
- Use the `API_PREFIX` constant (`/api/v1`, leading slash load-bearing) when touching API code.
- `user` is a reserved word in Postgres. Quote it in raw SQL.
- The repo root `tsconfig.base.json` targets CommonJS and `moduleResolution: node`. `apps/web/tsconfig.json` **must** override `module`, `moduleResolution`, `lib`, `jsx` and `noEmit`. Extending it without overriding produces a Next build that fails on the first `import`.

**Copy rule (spec §5.1), binding on every screen**

- No taglines, no field helper text, no empty-state explainer paragraphs, no instructional microcopy.
- A headline plus the action is the whole screen. A button names its action and stops.
- `EmptyState` and `Field` must ship with **no** prop for a description. This is the enforcement.
- Not copy, and therefore kept: a visible `<label>` on every control, an accessible name on every icon-only control, error text that names the problem **and** the recovery (WCAG 3.3.3), and the word inside a `StatusBadge`.

**Writing rule**

- No em dashes in code comments, commit messages, documentation or UI strings. Use a comma, a colon, parentheses, or a second sentence.
- Code comments are one or two lines, explaining *why* only where a reader would otherwise undo the line.
- Commit messages are a subject plus two or three lines.

**Test rule (the recurring defect in Stages 1 and 2)**

Before trusting a test, name the broken implementation it would catch. If you cannot, it is not testing anything. Each task below states, per test, what it catches. Do not drop those assertions.

**Security**

- Server-side authorization is re-derived from the database on every request. The UI hiding a control is presentation, never protection.
- Task 4 touches auth cookies. `/security-review` runs before it merges.
- No token, password or session value is ever logged.

**Commands**

```bash
pnpm install
pnpm --filter @majlis/web dev          # :3000
pnpm --filter @majlis/api start:dev    # :3001
pnpm typecheck && pnpm lint && pnpm test
pnpm --filter @majlis/web test:e2e
```

---

## File structure

| File | Responsibility |
|---|---|
| `apps/web/package.json`, `tsconfig.json`, `next.config.ts`, `postcss.config.mjs`, `vitest.config.ts` | Package configuration and the `/api/v1` rewrite |
| `apps/web/src/styles/globals.css` | Every design token, both themes, base element styling |
| `apps/web/src/styles/tokens.ts` | Token hex values as data, so tests can read them |
| `apps/web/src/styles/tokens.contrast.test.ts` | WCAG ratio assertions over `tokens.ts` |
| `apps/web/src/lib/brand.ts` | Product naming, single source |
| `apps/web/src/lib/fonts.ts` | `next/font` declarations |
| `apps/web/src/lib/api.ts` | Browser fetch client, `ProblemError`, 401 refresh-and-retry |
| `apps/web/src/lib/routing.ts` | `landingFor`, `decideRedirect`, pure, no framework imports |
| `apps/web/src/lib/session.ts` | Server-side `getSessionUser()` for layouts |
| `apps/web/src/middleware.ts` | Cookie-presence gate plus in-place session refresh |
| `apps/web/src/components/ui/*` | shadcn primitives re-pointed at our tokens |
| `apps/web/src/components/StatusBadge.tsx` | The single status enum renderer |
| `apps/web/src/components/EmptyState.tsx` | Headline plus action, no description prop |
| `apps/web/src/components/Field.tsx` | Label, control, error, no helper prop |
| `apps/web/src/components/shell/*` | `StudentShell`, `ConsoleShell`, nav and tab bar |
| `apps/web/src/app/**` | Routes per spec §3 |
| `apps/web/e2e/*.spec.ts` | Playwright plus axe |
| `apps/api/src/auth/cookies.ts` | Task 4 only: refresh cookie path |

---

## Task 1: Workspace scaffold, design tokens, contrast test

**Files:**
- Create: `apps/web/package.json`, `apps/web/tsconfig.json`, `apps/web/next.config.ts`, `apps/web/postcss.config.mjs`, `apps/web/vitest.config.ts`, `apps/web/next-env.d.ts`
- Create: `apps/web/src/styles/tokens.ts`, `apps/web/src/styles/globals.css`
- Create: `apps/web/src/app/layout.tsx`, `apps/web/src/app/page.tsx` (both temporary, replaced in Tasks 2 and 7)
- Test: `apps/web/src/styles/tokens.contrast.test.ts`
- Modify: `turbo.json` (add `.next/**` to build outputs)

**Interfaces:**
- Produces: `LIGHT` and `DARK` token records from `src/styles/tokens.ts`, both typed `Record<TokenName, string>` where `TokenName` is a string-literal union. Task 6 and Task 8 read token *names* from CSS, not from this module; only tests import it.

- [ ] **Step 1: Create the package manifest**

`apps/web/package.json`:

```json
{
  "name": "@majlis/web",
  "version": "0.0.0",
  "private": true,
  "scripts": {
    "dev": "next dev --port 3000",
    "build": "next build",
    "start": "next start --port 3000",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "lint": "eslint --no-error-on-unmatched-pattern src e2e",
    "test": "vitest run --config vitest.config.ts",
    "test:e2e": "playwright test"
  },
  "dependencies": {
    "@majlis/contracts": "workspace:*",
    "class-variance-authority": "0.7.1",
    "clsx": "2.1.1",
    "lucide-react": "1.43.0",
    "next": "16.3.4",
    "next-themes": "0.4.6",
    "react": "19.3.0",
    "react-dom": "19.3.0",
    "sonner": "2.0.8",
    "tailwind-merge": "3.6.0",
    "zod": "4.5.4"
  },
  "devDependencies": {
    "@axe-core/playwright": "4.13.0",
    "@playwright/test": "1.63.0",
    "@tailwindcss/postcss": "4.3.3",
    "@types/node": "22.14.0",
    "@types/react": "19.3.0",
    "@types/react-dom": "19.3.0",
    "eslint-config-next": "16.3.4",
    "tailwindcss": "4.3.3",
    "typescript": "5.9.3",
    "vitest": "5.0.0"
  }
}
```

Every version above was checked against npm and is older than 48 hours. `lucide-react` is pinned to `1.43.0`, not the current `1.45.0`, because `1.45.0` was published within the pnpm refusal window.

- [ ] **Step 2: Create the TypeScript config**

`apps/web/tsconfig.json`. Note the overrides called out in Global Constraints:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["DOM", "DOM.Iterable", "ES2023"],
    "module": "esnext",
    "moduleResolution": "bundler",
    "jsx": "preserve",
    "allowJs": true,
    "noEmit": true,
    "declaration": false,
    "sourceMap": false,
    "incremental": true,
    "experimentalDecorators": false,
    "emitDecoratorMetadata": false,
    "isolatedModules": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

`apps/web/next-env.d.ts`:

```ts
/// <reference types="next" />
/// <reference types="next/image-types/global" />
```

- [ ] **Step 3: Create the Next config with the API rewrite**

`apps/web/next.config.ts`. This rewrite is what makes the session cookie first-party and removes CORS entirely (spec §9.2):

```ts
import type { NextConfig } from 'next';

const API_ORIGIN = process.env.API_ORIGIN ?? 'http://localhost:3001';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  async rewrites() {
    return [{ source: '/api/v1/:path*', destination: `${API_ORIGIN}/api/v1/:path*` }];
  },
};

export default nextConfig;
```

`apps/web/postcss.config.mjs`:

```js
export default { plugins: { '@tailwindcss/postcss': {} } };
```

- [ ] **Step 4: Write the token module**

`apps/web/src/styles/tokens.ts`. These are the approved values from spec §2.1. The module exists so the contrast test reads the same numbers the CSS ships:

```ts
export const LIGHT = {
  bg: '#FAF7F2',
  surface: '#FFFFFF',
  surface2: '#F2EDE4',
  border: '#E3DACE',
  borderControl: '#90867A',
  ink: '#1C1713',
  ink2: '#5B5045',
  ink3: '#7C6F62',
  primary: '#0E5F55',
  primaryHover: '#0A4A42',
  primaryFg: '#FFFFFF',
  primarySoft: '#DEEDE9',
  primarySoftFg: '#0A443D',
  okSoft: '#DDEEDF',
  okFg: '#14602F',
  warnSoft: '#FBEBCE',
  warnFg: '#7A4B06',
  badSoft: '#F8DFDA',
  badFg: '#98291F',
  bad: '#A33228',
  infoSoft: '#E1E6F2',
  infoFg: '#3A4A80',
  muteSoft: '#EDE7DD',
  muteFg: '#5B5045',
} as const;

export const DARK: Record<keyof typeof LIGHT, string> = {
  bg: '#15110E',
  surface: '#1D1815',
  surface2: '#251F1B',
  border: '#372F28',
  borderControl: '#78675A',
  ink: '#F6F0E8',
  ink2: '#B6A899',
  ink3: '#948577',
  primary: '#5CC3AE',
  primaryHover: '#7BD3C1',
  primaryFg: '#062520',
  primarySoft: '#123830',
  primarySoftFg: '#8EDCCB',
  okSoft: '#15321F',
  okFg: '#82D497',
  warnSoft: '#3A2A0D',
  warnFg: '#EFBB63',
  badSoft: '#3A1C18',
  badFg: '#F0A197',
  bad: '#E2695C',
  infoSoft: '#1C2338',
  infoFg: '#A9B8E8',
  muteSoft: '#2A241F',
  muteFg: '#B6A899',
};

export type TokenName = keyof typeof LIGHT;
export type Theme = Record<TokenName, string>;
```

- [ ] **Step 5: Write the failing contrast test**

`apps/web/src/styles/tokens.contrast.test.ts`. Read the test-rule note under each `describe`:

```ts
import { describe, expect, it } from 'vitest';
import { DARK, LIGHT, type Theme } from './tokens';

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

export function luminance(hex: string): number {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

// [label, foreground, background, minimum]
function pairs(t: Theme): Array<[string, string, string, number]> {
  return [
    ['ink on bg', t.ink, t.bg, 4.5],
    ['ink on surface', t.ink, t.surface, 4.5],
    ['ink on surface2', t.ink, t.surface2, 4.5],
    ['ink2 on bg', t.ink2, t.bg, 4.5],
    ['ink2 on surface', t.ink2, t.surface, 4.5],
    ['ink2 on surface2', t.ink2, t.surface2, 4.5],
    ['ink3 on bg', t.ink3, t.bg, 4.5],
    ['ink3 on surface', t.ink3, t.surface, 4.5],
    ['primary on bg', t.primary, t.bg, 4.5],
    ['primary on surface', t.primary, t.surface, 4.5],
    ['primaryFg on primary', t.primaryFg, t.primary, 4.5],
    ['primaryFg on primaryHover', t.primaryFg, t.primaryHover, 4.5],
    ['primarySoftFg on primarySoft', t.primarySoftFg, t.primarySoft, 4.5],
    ['okFg on okSoft', t.okFg, t.okSoft, 4.5],
    ['warnFg on warnSoft', t.warnFg, t.warnSoft, 4.5],
    ['badFg on badSoft', t.badFg, t.badSoft, 4.5],
    ['infoFg on infoSoft', t.infoFg, t.infoSoft, 4.5],
    ['muteFg on muteSoft', t.muteFg, t.muteSoft, 4.5],
    ['bad on surface', t.bad, t.surface, 4.5],
    // SC 1.4.11: non-text contrast. 3:1, and the control border must clear it
    // against every ground an input can sit on, not just the easiest one.
    ['borderControl on bg', t.borderControl, t.bg, 3],
    ['borderControl on surface', t.borderControl, t.surface, 3],
    ['borderControl on surface2', t.borderControl, t.surface2, 3],
    ['focus ring (primary) on bg', t.primary, t.bg, 3],
    ['focus ring (primary) on surface', t.primary, t.surface, 3],
  ];
}

describe.each([
  ['light', LIGHT as Theme],
  ['dark', DARK],
])('%s theme contrast', (_name, theme) => {
  // Catches any token edited below its threshold. The first version of this
  // palette shipped borderControl at 1.79:1 against surface in both themes,
  // which this suite would have failed.
  it.each(pairs(theme))('%s meets %s:1', (_label, fg, bg, min) => {
    expect(contrast(fg, bg)).toBeGreaterThanOrEqual(min);
  });
});

describe('contrast()', () => {
  // Catches a luminance formula with swapped or dropped coefficients: those
  // still return plausible mid-range numbers for most pairs, so only the two
  // known extremes pin the function down.
  it('returns 21 for black on white', () => {
    expect(contrast('#000000', '#FFFFFF')).toBeCloseTo(21, 1);
  });

  it('returns 1 for a colour against itself', () => {
    expect(contrast('#0E5F55', '#0E5F55')).toBeCloseTo(1, 5);
  });

  // Catches an implementation that assumes foreground is always darker.
  it('is symmetric', () => {
    expect(contrast('#FAF7F2', '#1C1713')).toBeCloseTo(contrast('#1C1713', '#FAF7F2'), 10);
  });
});

describe('theme completeness', () => {
  // Catches a token added to light and forgotten in dark, which renders as an
  // unstyled or inherited colour only in dark mode and is easy to miss.
  it('dark defines every light token', () => {
    expect(Object.keys(DARK).sort()).toEqual(Object.keys(LIGHT).sort());
  });
});
```

`apps/web/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `pnpm --filter @majlis/web test`
Expected: FAIL, `Cannot find module './tokens'` has already been satisfied by Step 4, so the expected failure here is that `pnpm install` has not yet run. Run `pnpm install` first, then this command, and expect PASS. If any contrast assertion fails, a token value was mistyped in Step 4: fix the token, never the threshold.

- [ ] **Step 7: Write globals.css**

`apps/web/src/styles/globals.css`. Tailwind v4 pattern: runtime custom properties in `:root` and `.dark`, then `@theme inline` aliases them so utility classes resolve per theme.

```css
@import "tailwindcss";

@custom-variant dark (&:where(.dark, .dark *));

:root {
  --bg: #FAF7F2;
  --surface: #FFFFFF;
  --surface-2: #F2EDE4;
  --border: #E3DACE;
  --border-control: #90867A;
  --ink: #1C1713;
  --ink-2: #5B5045;
  --ink-3: #7C6F62;
  --primary: #0E5F55;
  --primary-hover: #0A4A42;
  --primary-fg: #FFFFFF;
  --primary-soft: #DEEDE9;
  --primary-soft-fg: #0A443D;
  --ok-soft: #DDEEDF;
  --ok-fg: #14602F;
  --warn-soft: #FBEBCE;
  --warn-fg: #7A4B06;
  --bad-soft: #F8DFDA;
  --bad-fg: #98291F;
  --bad: #A33228;
  --info-soft: #E1E6F2;
  --info-fg: #3A4A80;
  --mute-soft: #EDE7DD;
  --mute-fg: #5B5045;

  --shadow-sm: 0 1px 2px rgba(28, 23, 19, .06), 0 1px 1px rgba(28, 23, 19, .04);
  --shadow-md: 0 4px 12px -2px rgba(28, 23, 19, .10), 0 2px 4px -2px rgba(28, 23, 19, .06);
  --shadow-sheet: 0 -8px 32px -8px rgba(28, 23, 19, .18);
  --lattice: 14, 95, 85;

  color-scheme: light;
}

.dark {
  --bg: #15110E;
  --surface: #1D1815;
  --surface-2: #251F1B;
  --border: #372F28;
  --border-control: #78675A;
  --ink: #F6F0E8;
  --ink-2: #B6A899;
  --ink-3: #948577;
  --primary: #5CC3AE;
  --primary-hover: #7BD3C1;
  --primary-fg: #062520;
  --primary-soft: #123830;
  --primary-soft-fg: #8EDCCB;
  --ok-soft: #15321F;
  --ok-fg: #82D497;
  --warn-soft: #3A2A0D;
  --warn-fg: #EFBB63;
  --bad-soft: #3A1C18;
  --bad-fg: #F0A197;
  --bad: #E2695C;
  --info-soft: #1C2338;
  --info-fg: #A9B8E8;
  --mute-soft: #2A241F;
  --mute-fg: #B6A899;

  --shadow-sm: 0 1px 2px rgba(0, 0, 0, .4);
  --shadow-md: 0 4px 14px -2px rgba(0, 0, 0, .55), 0 2px 4px -2px rgba(0, 0, 0, .4);
  --shadow-sheet: 0 -8px 32px -8px rgba(0, 0, 0, .6);
  --lattice: 92, 195, 174;

  color-scheme: dark;
}

@theme inline {
  --color-bg: var(--bg);
  --color-surface: var(--surface);
  --color-surface-2: var(--surface-2);
  --color-border: var(--border);
  --color-border-control: var(--border-control);
  --color-ink: var(--ink);
  --color-ink-2: var(--ink-2);
  --color-ink-3: var(--ink-3);
  --color-primary: var(--primary);
  --color-primary-hover: var(--primary-hover);
  --color-primary-fg: var(--primary-fg);
  --color-primary-soft: var(--primary-soft);
  --color-primary-soft-fg: var(--primary-soft-fg);
  --color-ok-soft: var(--ok-soft);
  --color-ok-fg: var(--ok-fg);
  --color-warn-soft: var(--warn-soft);
  --color-warn-fg: var(--warn-fg);
  --color-bad-soft: var(--bad-soft);
  --color-bad-fg: var(--bad-fg);
  --color-bad: var(--bad);
  --color-info-soft: var(--info-soft);
  --color-info-fg: var(--info-fg);
  --color-mute-soft: var(--mute-soft);
  --color-mute-fg: var(--mute-fg);

  --font-sans: var(--font-plex), ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  --font-display: var(--font-fraunces), Georgia, "Times New Roman", serif;

  --text-display: 2.5rem;
  --text-display--line-height: 1.05;
  --text-display--letter-spacing: -0.022em;
  --text-title: 1.75rem;
  --text-title--line-height: 1.15;
  --text-title--letter-spacing: -0.018em;
  --text-h1: 1.375rem;
  --text-h1--line-height: 1.25;
  --text-h1--letter-spacing: -0.012em;
  --text-h2: 1.125rem;
  --text-h2--line-height: 1.35;
  --text-h2--letter-spacing: -0.006em;
  --text-body: 1rem;
  --text-body--line-height: 1.5;
  --text-sm: 0.875rem;
  --text-sm--line-height: 1.45;
  --text-label: 0.75rem;
  --text-label--line-height: 1.35;
  --text-label--letter-spacing: 0.07em;

  --radius-control: 8px;
  --radius-card: 12px;
  --radius-sheet: 20px;

  --ease-out: cubic-bezier(.2, .8, .25, 1);
}

:root {
  --dur-fast: 160ms;
  --dur: 220ms;
  --safe-b: env(safe-area-inset-bottom, 0px);
  --safe-t: env(safe-area-inset-top, 0px);
}

/* Collapsed once, at the token level, so no component has to remember it. */
@media (prefers-reduced-motion: reduce) {
  :root { --dur-fast: 0.01ms; --dur: 0.01ms; }
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}

@layer base {
  * { border-color: var(--color-border); }

  body {
    background: var(--color-bg);
    color: var(--color-ink);
    font-family: var(--font-sans);
    font-size: var(--text-body);
    line-height: 1.5;
    -webkit-font-smoothing: antialiased;
  }

  /* Browser surfaces take the palette instead of shipping defaults. */
  ::selection { background: var(--color-primary); color: var(--color-primary-fg); }
  :root { accent-color: var(--color-primary); caret-color: var(--color-primary); scrollbar-color: var(--color-border-control) transparent; }

  :focus-visible {
    outline: 2px solid var(--color-primary);
    outline-offset: 2px;
    border-radius: 3px;
  }

  /* Figures line up everywhere a count, capacity, time or ID is shown. */
  .tabular { font-variant-numeric: tabular-nums; }
}

@utility lattice {
  background-image:
    repeating-linear-gradient(45deg, rgb(var(--lattice) / .05) 0 1px, transparent 1px 22px),
    repeating-linear-gradient(-45deg, rgb(var(--lattice) / .05) 0 1px, transparent 1px 22px);
}
```

- [ ] **Step 8: Add a temporary root layout and page so the build has an entry point**

`apps/web/src/app/layout.tsx` (replaced in Task 2):

```tsx
import type { ReactNode } from 'react';
import '@/styles/globals.css';

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
```

`apps/web/src/app/page.tsx` (replaced in Task 7):

```tsx
export default function Page() {
  return <main id="main">Majlis</main>;
}
```

- [ ] **Step 9: Add `.next` to turbo build outputs**

Modify `turbo.json`, changing the `build` task line to:

```json
"build": { "dependsOn": ["^build"], "outputs": ["dist/**", ".next/**", "!.next/cache/**"] },
```

- [ ] **Step 10: Install, test, build**

```bash
pnpm install
pnpm --filter @majlis/web test
pnpm --filter @majlis/web typecheck
pnpm --filter @majlis/web build
```

Expected: tests PASS, typecheck clean, build succeeds. If `pnpm install` refuses a version as too recently published, report it rather than adding an exclude.

- [ ] **Step 11: Commit**

```bash
git add apps/web turbo.json pnpm-lock.yaml
git commit -m "feat(web): scaffold Next.js app with design tokens

Tailwind v4 tokens for both themes, verified by a contrast suite that
asserts 4.5:1 on text and 3:1 on control borders and focus rings."
```

---

## Task 2: Fonts, brand, theme, root layout

**Files:**
- Create: `apps/web/src/lib/brand.ts`, `apps/web/src/lib/fonts.ts`, `apps/web/src/lib/cn.ts`
- Create: `apps/web/src/components/ThemeProvider.tsx`, `apps/web/src/components/ThemeToggle.tsx`
- Modify: `apps/web/src/app/layout.tsx`
- Test: `apps/web/src/lib/brand.test.ts`

**Interfaces:**
- Consumes: `src/styles/globals.css` from Task 1.
- Produces:
  - `BRAND: { product: string; themeColor: string }` from `@/lib/brand`
  - `cn(...inputs: ClassValue[]): string` from `@/lib/cn`
  - `plex`, `fraunces` font objects from `@/lib/fonts`, whose `.variable` values are `--font-plex` and `--font-fraunces` and are already referenced by `globals.css`
  - `<ThemeProvider>` and `<ThemeToggle>` from `@/components/`

- [ ] **Step 1: Write brand, cn and fonts**

`apps/web/src/lib/brand.ts`. Spec §9.5 requires a rename to be one line:

```ts
export const BRAND = {
  product: 'Majlis',
  themeColor: '#0E5F55',
} as const;
```

`apps/web/src/lib/cn.ts`:

```ts
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
```

`apps/web/src/lib/fonts.ts`. The CSS variable names must match the `@theme inline` block written in Task 1:

```ts
import { Fraunces, IBM_Plex_Sans } from 'next/font/google';

export const plex = IBM_Plex_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-plex',
  display: 'swap',
});

export const fraunces = Fraunces({
  subsets: ['latin'],
  weight: ['600'],
  axes: ['SOFT', 'WONK', 'opsz'],
  variable: '--font-fraunces',
  display: 'swap',
});
```

- [ ] **Step 2: Write the failing brand test**

`apps/web/src/lib/brand.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { BRAND } from './brand';

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

describe('BRAND', () => {
  it('matches the theme colour shipped in globals.css', () => {
    // Catches the manifest and the CSS drifting apart, which shows up only as
    // a wrong browser chrome colour on an installed PWA and is never noticed.
    const css = readFileSync('src/styles/globals.css', 'utf8');
    expect(css).toContain(BRAND.themeColor);
  });

  it('is the only place the product name is written', () => {
    // Catches a component hardcoding "Majlis", which spec 9.5 forbids so a
    // rename stays one line. A test that only asserted BRAND.product === 'Majlis'
    // would pass against a codebase that hardcodes the name in twenty files.
    const offenders = walk('src')
      .filter((f) => /\.tsx?$/.test(f) && !f.endsWith('brand.ts') && !f.endsWith('brand.test.ts'))
      .filter((f) => readFileSync(f, 'utf8').includes('Majlis'));
    expect(offenders).toEqual([]);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter @majlis/web test src/lib/brand.test.ts`
Expected: FAIL on the second case, because `src/app/page.tsx` from Task 1 contains the literal `Majlis`.

- [ ] **Step 4: Write the theme provider and toggle**

`apps/web/src/components/ThemeProvider.tsx`:

```tsx
'use client';

import { ThemeProvider as NextThemes } from 'next-themes';
import type { ReactNode } from 'react';

export function ThemeProvider({ children }: { children: ReactNode }) {
  return (
    <NextThemes attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      {children}
    </NextThemes>
  );
}
```

`apps/web/src/components/ThemeToggle.tsx`. The button is icon-only, so it carries an accessible name. That is not copy, it is SC 4.1.2:

```tsx
'use client';

import { Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const dark = mounted && resolvedTheme === 'dark';

  return (
    <button
      type="button"
      aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
      onClick={() => setTheme(dark ? 'light' : 'dark')}
      className="grid size-11 place-items-center rounded-control text-ink-2 hover:bg-surface-2 hover:text-ink"
    >
      {dark ? <Sun className="size-5" aria-hidden /> : <Moon className="size-5" aria-hidden />}
    </button>
  );
}
```

- [ ] **Step 5: Rewrite the root layout**

`apps/web/src/app/layout.tsx`. The skip link is SC 2.4.1:

```tsx
import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { Toaster } from 'sonner';
import { ThemeProvider } from '@/components/ThemeProvider';
import { BRAND } from '@/lib/brand';
import { fraunces, plex } from '@/lib/fonts';
import '@/styles/globals.css';

export const metadata: Metadata = {
  title: { default: BRAND.product, template: `%s · ${BRAND.product}` },
  applicationName: BRAND.product,
};

export const viewport: Viewport = {
  themeColor: BRAND.themeColor,
  viewportFit: 'cover',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={`${plex.variable} ${fraunces.variable}`}>
      <body>
        <ThemeProvider>
          <a
            href="#main"
            className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-control focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-fg"
          >
            Skip to content
          </a>
          {children}
          <Toaster position="top-center" />
        </ThemeProvider>
      </body>
    </html>
  );
}
```

Replace `apps/web/src/app/page.tsx` with a version that reads the name from `BRAND` so the test passes:

```tsx
import { BRAND } from '@/lib/brand';

export default function Page() {
  return <main id="main">{BRAND.product}</main>;
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm --filter @majlis/web test && pnpm --filter @majlis/web typecheck && pnpm --filter @majlis/web build`
Expected: PASS, clean, build succeeds.

- [ ] **Step 7: Commit**

```bash
git add apps/web
git commit -m "feat(web): fonts, brand module, theme provider

IBM Plex Sans and Fraunces self-hosted through next/font. A test asserts
the product name appears nowhere outside lib/brand.ts."
```

---

## Task 3: API client

**Files:**
- Create: `apps/web/src/lib/api.ts`
- Test: `apps/web/src/lib/api.test.ts`

**Interfaces:**
- Consumes: `problemDetailsSchema`, `ProblemFieldError` from `@majlis/contracts`.
- Produces, all from `@/lib/api`:
  - `class ProblemError extends Error` with readonly `status: number`, `title: string`, `detail?: string`, `requestId?: string`, `errors: ProblemFieldError[]`, and `fieldError(path: string): string | undefined`
  - `apiFetch<T>(path: string, init?: RequestInit): Promise<T>`
  - `API_BASE = '/api/v1'`

- [ ] **Step 1: Write the failing tests**

`apps/web/src/lib/api.test.ts`. Every case names what it catches:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiFetch, ProblemError } from './api';

type Call = { url: string; init?: RequestInit };

function mockFetch(responses: Array<() => Response>) {
  const calls: Call[] = [];
  let i = 0;
  const fn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const make = responses[Math.min(i, responses.length - 1)];
    i += 1;
    return make();
  });
  vi.stubGlobal('fetch', fn);
  return calls;
}

const json = (body: unknown, status = 200, type = 'application/json') =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': type } });

const problem = (status: number, extra: Record<string, unknown> = {}) =>
  json({ type: 'about:blank', title: 'Nope', status, ...extra }, status, 'application/problem+json');

afterEach(() => vi.unstubAllGlobals());

describe('apiFetch', () => {
  it('returns the parsed body on 200', async () => {
    mockFetch([() => json({ id: 'u1' })]);
    await expect(apiFetch<{ id: string }>('/auth/me')).resolves.toEqual({ id: 'u1' });
  });

  it('prefixes the path with /api/v1 and sends credentials', async () => {
    // Catches a client that calls the API origin directly. That bypasses the
    // rewrite, makes the request cross-origin, and the session cookie stops
    // being sent at all, which presents as "randomly logged out".
    const calls = mockFetch([() => json({})]);
    await apiFetch('/auth/me');
    expect(calls[0]?.url).toBe('/api/v1/auth/me');
    expect(calls[0]?.init?.credentials).toBe('same-origin');
  });

  it('throws ProblemError carrying status, title and errors[]', async () => {
    mockFetch([
      () =>
        problem(422, {
          detail: 'Validation failed',
          requestId: 'req-1',
          errors: [{ path: 'email', message: 'Enter a university email address.' }],
        }),
    ]);
    const err = await apiFetch('/auth/signup', { method: 'POST' }).catch((e) => e);
    expect(err).toBeInstanceOf(ProblemError);
    expect(err.status).toBe(422);
    expect(err.requestId).toBe('req-1');
    expect(err.fieldError('email')).toBe('Enter a university email address.');
    expect(err.fieldError('password')).toBeUndefined();
  });

  it('refreshes once and retries the original request on 401', async () => {
    // Catches both halves of the contract. An implementation that retries
    // without refreshing, or refreshes without retrying, fails here; a test
    // that only asserted the final value would pass against both.
    const calls = mockFetch([
      () => problem(401),
      () => json({}),            // refresh
      () => json({ id: 'u1' }),  // retry
    ]);
    await expect(apiFetch<{ id: string }>('/me')).resolves.toEqual({ id: 'u1' });
    expect(calls.map((c) => c.url)).toEqual(['/api/v1/me', '/api/v1/auth/refresh', '/api/v1/me']);
    expect(calls[1]?.init?.method).toBe('POST');
  });

  it('does not retry more than once when the retry also 401s', async () => {
    // Catches a recursive retry, which loops forever against an expired
    // refresh token and hangs the tab instead of redirecting to login.
    const calls = mockFetch([() => problem(401)]);
    await expect(apiFetch('/me')).rejects.toBeInstanceOf(ProblemError);
    expect(calls).toHaveLength(3);
  });

  it('does not attempt a refresh when the refresh endpoint itself 401s', async () => {
    // Catches infinite recursion through the refresh path specifically.
    const calls = mockFetch([() => problem(401)]);
    await expect(apiFetch('/auth/refresh', { method: 'POST' })).rejects.toBeInstanceOf(ProblemError);
    expect(calls).toHaveLength(1);
  });

  it('throws ProblemError on a non-JSON 500 rather than a parse error', async () => {
    // Catches an unguarded res.json(). A proxy or gateway 500 is HTML, and an
    // unguarded parse throws SyntaxError, which loses the status entirely and
    // renders as a blank screen rather than an error state.
    mockFetch([() => new Response('<html>502</html>', { status: 502, headers: { 'content-type': 'text/html' } })]);
    const err = await apiFetch('/me').catch((e) => e);
    expect(err).toBeInstanceOf(ProblemError);
    expect(err.status).toBe(502);
    expect(err.errors).toEqual([]);
  });

  it('returns undefined for a 204', async () => {
    // Catches res.json() on an empty body, which logout returns.
    mockFetch([() => new Response(null, { status: 204 })]);
    await expect(apiFetch('/auth/logout', { method: 'POST' })).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @majlis/web test src/lib/api.test.ts`
Expected: FAIL with `Cannot find module './api'`.

- [ ] **Step 3: Write the implementation**

`apps/web/src/lib/api.ts`:

```ts
import { problemDetailsSchema, type ProblemFieldError } from '@majlis/contracts';

export const API_BASE = '/api/v1';

const REFRESH_PATH = '/auth/refresh';

export class ProblemError extends Error {
  readonly status: number;
  readonly title: string;
  readonly detail: string | undefined;
  readonly requestId: string | undefined;
  readonly errors: ProblemFieldError[];

  constructor(init: {
    status: number;
    title: string;
    detail?: string;
    requestId?: string;
    errors?: ProblemFieldError[];
  }) {
    super(init.detail ?? init.title);
    this.name = 'ProblemError';
    this.status = init.status;
    this.title = init.title;
    this.detail = init.detail;
    this.requestId = init.requestId;
    this.errors = init.errors ?? [];
  }

  fieldError(path: string): string | undefined {
    return this.errors.find((e) => e.path === path)?.message;
  }
}

async function toProblem(res: Response): Promise<ProblemError> {
  try {
    const parsed = problemDetailsSchema.safeParse(await res.json());
    if (parsed.success) {
      return new ProblemError({
        status: parsed.data.status,
        title: parsed.data.title,
        ...(parsed.data.detail === undefined ? {} : { detail: parsed.data.detail }),
        ...(parsed.data.requestId === undefined ? {} : { requestId: parsed.data.requestId }),
        ...(parsed.data.errors === undefined ? {} : { errors: parsed.data.errors }),
      });
    }
  } catch {
    // A gateway error is HTML, not JSON. Fall through to the status-only form.
  }
  return new ProblemError({ status: res.status, title: res.statusText || 'Request failed' });
}

async function send(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${API_BASE}${path}`, {
    ...init,
    credentials: 'same-origin',
    headers: { accept: 'application/json', ...init?.headers },
  });
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  let res = await send(path, init);

  // The refresh token does not rotate, so concurrent refreshes are harmless
  // and no client-side dedupe is needed. Retry exactly once, and never from
  // the refresh path itself, which would recurse.
  if (res.status === 401 && path !== REFRESH_PATH) {
    const refreshed = await send(REFRESH_PATH, { method: 'POST' });
    if (refreshed.ok) res = await send(path, init);
  }

  if (!res.ok) throw await toProblem(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @majlis/web test src/lib/api.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/api.ts apps/web/src/lib/api.test.ts
git commit -m "feat(web): API client with problem+json and 401 retry

Refreshes once and retries once on 401, never from the refresh path itself.
A non-JSON gateway error becomes a ProblemError rather than a SyntaxError."
```

---

## Task 4: Widen the refresh cookie path (auth change, security review required)

Spec §4.1. Without this, `middleware.ts` cannot see the refresh cookie on a page navigation, so a user with 29 valid days left is redirected to `/login` after 15 idle minutes.

**Files:**
- Modify: `apps/api/src/auth/cookies.ts`
- Modify: `apps/api/src/auth/cookies.spec.ts:57`, `:73-79`

**Interfaces:**
- Produces: `REFRESH_COOKIE_PATH === '/'`. Task 5's middleware depends on the browser sending `majlis_refresh` on page requests.

- [ ] **Step 1: Update the failing test first**

In `apps/api/src/auth/cookies.spec.ts`, replace the two assertions that pin the old path. The existing test at line 78 asserts `REFRESH_COOKIE_PATH.startsWith(API_PREFIX)`, which is now false by design, so the whole `describe` block is rewritten:

```ts
describe('REFRESH_COOKIE_PATH', () => {
  // Widened from `${API_PREFIX}/auth` to '/' in Stage 3. A path-scoped refresh
  // cookie is not sent on a page navigation, so Next.js middleware cannot see
  // it and redirects a user with a valid 30-day session to /login after the
  // 15-minute session cookie expires. This test pins the widening so a later
  // "tighten the cookie path" cleanup fails loudly instead of silently
  // breaking navigation for every signed-in user.
  it('is the site root so middleware receives it on page navigations', () => {
    expect(REFRESH_COOKIE_PATH).toBe('/');
  });
});
```

And at line 57, change:

```ts
expect(refreshCookieOptions(true).path).toBe('/');
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @majlis/api test src/auth/cookies.spec.ts`
Expected: FAIL, both assertions, receiving `/api/v1/auth`.

- [ ] **Step 3: Change the constant**

In `apps/api/src/auth/cookies.ts`, replace the `REFRESH_COOKIE_PATH` declaration and its comment:

```ts
/**
 * The site root, not `${API_PREFIX}/auth`. A path-scoped cookie is not sent on
 * a page navigation, so Next.js middleware could not see it and would redirect
 * a user with a valid 30-day session to /login after 15 minutes. Widening it
 * lets middleware refresh the session in place. The token stays httpOnly,
 * Secure, SameSite=Lax and opaque, and is stored only as a SHA-256 hash.
 */
export const REFRESH_COOKIE_PATH = '/';
```

Remove the now-unused `API_PREFIX` import if nothing else in the file uses it.

- [ ] **Step 4: Run the full API suite**

Run: `pnpm --filter @majlis/api test && pnpm --filter @majlis/api test:integration`
Expected: all PASS. `logout` clears the cookie using the same options object, so the clear still matches the set. If an integration test asserts a `Set-Cookie` header containing `Path=/api/v1/auth`, update it and note it in the commit.

- [ ] **Step 5: Run the security review**

Run `/security-review`. This is the gate named in CLAUDE.md for anything touching auth, tokens or permissions. Report its findings before committing. Do not proceed to Task 5 if it flags this change.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/auth
git commit -m "fix(auth): widen refresh cookie to Path=/

A path-scoped refresh cookie is not sent on page navigations, so Next.js
middleware could not refresh an expired session and bounced valid users to
login after 15 minutes. Still httpOnly, Secure, SameSite=Lax."
```

---

## Task 5: Routing rules, middleware, server session helper

**Files:**
- Create: `apps/web/src/lib/routing.ts`, `apps/web/src/lib/session.ts`, `apps/web/src/middleware.ts`
- Test: `apps/web/src/lib/routing.test.ts`

**Interfaces:**
- Consumes: `SessionUser` from `@majlis/contracts` (`sessionUserSchema`), `apiFetch` from Task 3, `REFRESH_COOKIE_PATH === '/'` from Task 4.
- Produces, from `@/lib/routing`:
  - `landingFor(user: SessionUser): string`
  - `decideRedirect(input: { pathname: string; hasSession: boolean; hasRefresh: boolean }): { to: string } | null`
  - `SESSION_COOKIE = 'majlis_session'`, `REFRESH_COOKIE = 'majlis_refresh'`
- Produces, from `@/lib/session`: `getSessionUser(): Promise<SessionUser | null>` and `requireUser(): Promise<SessionUser>` (redirects to `/login` when absent).

- [ ] **Step 1: Write the failing routing tests**

`apps/web/src/lib/routing.test.ts`. The conflicting-role cases are the point of this suite:

```ts
import { describe, expect, it } from 'vitest';
import type { SessionUser } from '@majlis/contracts';
import { decideRedirect, landingFor } from './routing';

const user = (over: Partial<SessionUser> = {}): SessionUser => ({
  id: 'u1',
  email: 'a@uni.ac.ae',
  fullName: 'A Student',
  avatarUrl: null,
  platformRole: 'STUDENT',
  clubRoles: [],
  ...over,
});

describe('landingFor', () => {
  it('sends a plain student to /home', () => {
    expect(landingFor(user())).toBe('/home');
  });

  it('sends an admin to /admin', () => {
    expect(landingFor(user({ platformRole: 'ADMIN' }))).toBe('/admin');
  });

  it('sends an officer to their club console', () => {
    expect(landingFor(user({ clubRoles: [{ clubId: 'c1', role: 'LEAD' }] }))).toBe('/manage/c1');
  });

  it('prefers /admin for a user who is BOTH admin and officer', () => {
    // Catches an implementation that checks clubRoles first. Such a code path
    // passes every single-role test above, and only an admin who also happens
    // to lead a club is ever misrouted, which is the demo account.
    expect(
      landingFor(user({ platformRole: 'ADMIN', clubRoles: [{ clubId: 'c1', role: 'LEAD' }] })),
    ).toBe('/admin');
  });

  it('picks the same club every time for an officer of several', () => {
    // Catches clubRoles[0], which follows whatever order the API returned and
    // can land the same person on a different console between two page loads.
    const roles = [
      { clubId: 'c9', role: 'LEAD' },
      { clubId: 'c2', role: 'OPERATIONS' },
      { clubId: 'c5', role: 'MARKETING' },
    ];
    expect(landingFor(user({ clubRoles: roles }))).toBe('/manage/c2');
    expect(landingFor(user({ clubRoles: [...roles].reverse() }))).toBe('/manage/c2');
  });
});

describe('decideRedirect', () => {
  const anon = { hasSession: false, hasRefresh: false };
  const live = { hasSession: true, hasRefresh: true };
  const stale = { hasSession: false, hasRefresh: true };

  it('sends an anonymous visitor from a protected route to /login', () => {
    expect(decideRedirect({ pathname: '/home', ...anon })).toEqual({ to: '/login' });
  });

  it('lets a signed-in visitor through a protected route', () => {
    expect(decideRedirect({ pathname: '/home', ...live })).toBeNull();
  });

  it('lets a stale-session visitor through so middleware can refresh', () => {
    // Catches the defect this whole task exists for. Treating a missing session
    // cookie as "anonymous" logs out every user after 15 idle minutes even
    // though they hold a valid 30-day refresh token.
    expect(decideRedirect({ pathname: '/home', ...stale })).toBeNull();
  });

  it('sends a signed-in visitor away from /login', () => {
    expect(decideRedirect({ pathname: '/login', ...live })).toEqual({ to: '/' });
  });

  it('leaves an anonymous visitor on /login', () => {
    expect(decideRedirect({ pathname: '/login', ...anon })).toBeNull();
  });

  it('never gates public certificate verification', () => {
    // Catches a prefix match that gates everything not explicitly allowed.
    // /verify is opened by an employer who has no account at all.
    expect(decideRedirect({ pathname: '/verify/ABC123', ...anon })).toBeNull();
  });

  it('does not treat /loginary as the login route', () => {
    // Catches pathname.startsWith('/login'), which would send an anonymous
    // visitor of any route beginning with those characters to the wrong place.
    expect(decideRedirect({ pathname: '/loginary', ...anon })).toEqual({ to: '/login' });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @majlis/web test src/lib/routing.test.ts`
Expected: FAIL with `Cannot find module './routing'`.

- [ ] **Step 3: Write the routing rules**

`apps/web/src/lib/routing.ts`. No framework imports, so this stays unit-testable:

```ts
import type { SessionUser } from '@majlis/contracts';

export const SESSION_COOKIE = 'majlis_session';
export const REFRESH_COOKIE = 'majlis_refresh';

/** Routes reachable with no account at all. */
const PUBLIC_PREFIXES = ['/verify'];

/** Routes that exist to sign in, and must bounce an already-signed-in visitor. */
const AUTH_ROUTES = ['/login', '/signup'];

export function landingFor(user: SessionUser): string {
  if (user.platformRole === 'ADMIN') return '/admin';
  const clubIds = user.clubRoles.map((r) => r.clubId).sort();
  const first = clubIds[0];
  return first ? `/manage/${first}` : '/home';
}

function isUnder(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export function decideRedirect(input: {
  pathname: string;
  hasSession: boolean;
  hasRefresh: boolean;
}): { to: string } | null {
  const { pathname, hasSession, hasRefresh } = input;

  if (PUBLIC_PREFIXES.some((p) => isUnder(pathname, p))) return null;

  // A missing session cookie with a live refresh cookie is a refreshable
  // session, not an anonymous visitor. Middleware renews it in place.
  const signedIn = hasSession || hasRefresh;

  if (AUTH_ROUTES.includes(pathname)) return signedIn ? { to: '/' } : null;
  return signedIn ? null : { to: '/login' };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @majlis/web test src/lib/routing.test.ts`
Expected: PASS, 12 tests.

- [ ] **Step 5: Write the middleware**

`apps/web/src/middleware.ts`. It gates on cookie presence and renews an expired session. It never decodes a token and never makes an authorization decision, which stays server-side in each layout:

```ts
import { NextResponse, type NextRequest } from 'next/server';
import { decideRedirect, REFRESH_COOKIE, SESSION_COOKIE } from '@/lib/routing';

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icons/|manifest.webmanifest|sw.js).*)'],
};

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const hasSession = req.cookies.has(SESSION_COOKIE);
  const hasRefresh = req.cookies.has(REFRESH_COOKIE);

  const redirect = decideRedirect({ pathname, hasSession, hasRefresh });
  if (redirect) return NextResponse.redirect(new URL(redirect.to, req.url));

  // Session expired but the 30-day refresh token is still here. Renew it now
  // so the navigation continues instead of bouncing the user to /login.
  if (!hasSession && hasRefresh) {
    const renewed = await fetch(new URL('/api/v1/auth/refresh', req.url), {
      method: 'POST',
      headers: { cookie: req.headers.get('cookie') ?? '' },
    });

    if (!renewed.ok) {
      const res = NextResponse.redirect(new URL('/login', req.url));
      res.cookies.delete(REFRESH_COOKIE);
      return res;
    }

    const res = NextResponse.next();
    for (const cookie of renewed.headers.getSetCookie()) {
      res.headers.append('set-cookie', cookie);
    }
    return res;
  }

  return NextResponse.next();
}
```

- [ ] **Step 6: Write the server session helper**

`apps/web/src/lib/session.ts`. Server Components cannot set cookies, so this one does not refresh. Middleware has already renewed the session by the time a layout runs:

```ts
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { sessionUserSchema, type SessionUser } from '@majlis/contracts';

async function origin(): Promise<string> {
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000';
  const proto = h.get('x-forwarded-proto') ?? 'http';
  return `${proto}://${host}`;
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const cookie = (await cookies()).toString();
  if (!cookie) return null;

  const res = await fetch(`${await origin()}/api/v1/auth/me`, {
    headers: { cookie, accept: 'application/json' },
    cache: 'no-store',
  });
  if (!res.ok) return null;

  const parsed = sessionUserSchema.safeParse(await res.json());
  return parsed.success ? parsed.data : null;
}

/**
 * Never render a page and then show an "authentication required" panel inside
 * it (spec 9.1). Layouts call this before returning any markup.
 */
export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  return user;
}
```

- [ ] **Step 7: Verify and commit**

Run: `pnpm --filter @majlis/web test && pnpm --filter @majlis/web typecheck && pnpm --filter @majlis/web build`
Expected: PASS, clean, build succeeds.

```bash
git add apps/web/src/lib/routing.ts apps/web/src/lib/routing.test.ts apps/web/src/lib/session.ts apps/web/src/middleware.ts
git commit -m "feat(web): role routing, middleware gate, server session

Middleware gates on cookie presence and renews an expired session in place
using the refresh cookie. Authorization stays server-side in each layout."
```

---

## Task 6: Component layer

**Files:**
- Create: `apps/web/components.json`
- Create via CLI then re-point: `apps/web/src/components/ui/{button,input,label,sheet,dropdown-menu,avatar,skeleton}.tsx`
- Create: `apps/web/src/components/StatusBadge.tsx`, `EmptyState.tsx`, `Field.tsx`, `PageError.tsx`
- Test: `apps/web/src/components/StatusBadge.test.ts`

**Interfaces:**
- Consumes: `cn` from Task 2, tokens from Task 1.
- Produces:
  - `STATUS_TONE: Record<StatusKey, Tone>` and `<StatusBadge status={...} />` from `@/components/StatusBadge`
  - `<EmptyState title={...} action={...} />` from `@/components/EmptyState`, with **no** `description` prop
  - `<Field label={...} error={...}>{control}</Field>` from `@/components/Field`, with **no** `description` or `hint` prop
  - `<PageError title={...} />` from `@/components/PageError`

- [ ] **Step 1: Install the shadcn primitives**

```bash
cd apps/web
pnpm dlx shadcn@4.21.0 init --yes --base-color neutral --css-variables
pnpm dlx shadcn@4.21.0 add button input label sheet dropdown-menu avatar skeleton --yes
cd ../..
pnpm install
```

**Known hazard:** the CLI installs Radix packages at their latest versions, and pnpm 11 refuses anything published in the last 24 hours. If `pnpm install` fails for that reason, pin the offending package to the previous release in `apps/web/package.json` and reinstall. Do not add `minimumReleaseAgeExclude`.

**Second known hazard:** `init` rewrites `globals.css` with its own oklch palette. Restore ours immediately:

```bash
git checkout apps/web/src/styles/globals.css
```

Then confirm nothing was lost: `git diff --stat apps/web/src/styles/globals.css` must be empty.

- [ ] **Step 2: Re-point the primitives at our tokens**

shadcn components ship referencing `bg-primary`, `text-primary-foreground`, `border-input`, `bg-background`, `text-muted-foreground` and similar. Our `@theme` defines `primary`, `primary-fg`, `border-control`, `bg`, `ink-3`. Edit each generated file so the classes resolve against our names. There is no parallel shadcn palette; that is the point.

Mapping to apply throughout `src/components/ui/`:

| shadcn class | Majlis class |
|---|---|
| `bg-background` | `bg-bg` |
| `text-foreground` | `text-ink` |
| `bg-card` | `bg-surface` |
| `bg-muted`, `bg-accent` | `bg-surface-2` |
| `text-muted-foreground` | `text-ink-2` |
| `bg-primary` | `bg-primary` (unchanged) |
| `text-primary-foreground` | `text-primary-fg` |
| `hover:bg-primary/90` | `hover:bg-primary-hover` |
| `border-input` | `border-border-control` |
| `bg-destructive` | `bg-bad` |
| `ring-ring`, `ring-offset-background` | remove; the global `:focus-visible` rule in `globals.css` owns focus |
| `rounded-md` | `rounded-control` |

Verify no shadcn token names survive:

```bash
grep -rnE "background|foreground|muted|destructive|ring-ring|border-input" apps/web/src/components/ui/
```

Expected: no matches other than the words inside comments or prop names.

- [ ] **Step 3: Write the failing StatusBadge test**

`apps/web/src/components/StatusBadge.test.ts`. This tests the tone map, which is pure data, so no DOM is needed:

```ts
import { describe, expect, it } from 'vitest';
import { STATUS_LABEL, STATUS_TONE } from './StatusBadge';

describe('status vocabulary', () => {
  it('gives every status a tone and a word', () => {
    // Catches a status added to one map and not the other, which renders as an
    // unstyled or unlabelled badge for exactly one enum value in production.
    expect(Object.keys(STATUS_TONE).sort()).toEqual(Object.keys(STATUS_LABEL).sort());
  });

  it('never leaves a label empty', () => {
    // Colour alone must never carry meaning (spec 9.5). An empty label renders
    // a bare coloured pill, which passes a "renders without crashing" test.
    for (const [key, label] of Object.entries(STATUS_LABEL)) {
      expect(label.trim(), `${key} has no word`).not.toBe('');
    }
  });

  it('distinguishes cancelled from confirmed by tone', () => {
    // Catches a copy-paste that maps every status to the same tone, which
    // still satisfies the completeness test above.
    expect(STATUS_TONE.CANCELLED).not.toBe(STATUS_TONE.CONFIRMED);
  });
});
```

- [ ] **Step 4: Run it to verify it fails**

Run: `pnpm --filter @majlis/web test src/components/StatusBadge.test.ts`
Expected: FAIL with `Cannot find module './StatusBadge'`.

- [ ] **Step 5: Write the Majlis components**

`apps/web/src/components/StatusBadge.tsx`:

```tsx
import { BadgeCheck, Check, CircleAlert, Clock, FileText, KeyRound, X } from 'lucide-react';
import type { ComponentType } from 'react';
import { cn } from '@/lib/cn';

export const STATUS_LABEL = {
  CONFIRMED: 'Confirmed',
  WAITLISTED: 'Waitlisted',
  CANCELLED: 'Cancelled',
  DRAFT: 'Draft',
  PUBLISHED: 'Published',
  LIVE: 'Live now',
  COMPLETED: 'Completed',
  ACTIVE: 'Active',
  SUSPENDED: 'Suspended',
  INVITED: 'Invited',
  REQUESTED: 'Requested',
  ISSUED: 'Issued',
  REVOKED: 'Revoked',
} as const;

export type StatusKey = keyof typeof STATUS_LABEL;
type Tone = 'ok' | 'warn' | 'bad' | 'info' | 'brand' | 'mute';

export const STATUS_TONE: Record<StatusKey, Tone> = {
  CONFIRMED: 'ok',
  WAITLISTED: 'warn',
  CANCELLED: 'bad',
  DRAFT: 'mute',
  PUBLISHED: 'brand',
  LIVE: 'info',
  COMPLETED: 'mute',
  ACTIVE: 'ok',
  SUSPENDED: 'bad',
  INVITED: 'info',
  REQUESTED: 'warn',
  ISSUED: 'ok',
  REVOKED: 'bad',
};

const ICON: Record<StatusKey, ComponentType<{ className?: string }>> = {
  CONFIRMED: Check,
  WAITLISTED: Clock,
  CANCELLED: X,
  DRAFT: FileText,
  PUBLISHED: Check,
  LIVE: Clock,
  COMPLETED: Check,
  ACTIVE: Check,
  SUSPENDED: CircleAlert,
  INVITED: KeyRound,
  REQUESTED: Clock,
  ISSUED: BadgeCheck,
  REVOKED: X,
};

const TONE_CLASS: Record<Tone, string> = {
  ok: 'bg-ok-soft text-ok-fg',
  warn: 'bg-warn-soft text-warn-fg',
  bad: 'bg-bad-soft text-bad-fg',
  info: 'bg-info-soft text-info-fg',
  brand: 'bg-primary-soft text-primary-soft-fg',
  mute: 'bg-mute-soft text-mute-fg',
};

export function StatusBadge({ status, className }: { status: StatusKey; className?: string }) {
  const Icon = ICON[status];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full py-0.5 pl-1.5 pr-2.5 text-label font-semibold',
        TONE_CLASS[STATUS_TONE[status]],
        className,
      )}
    >
      <Icon className="size-3.5 shrink-0" aria-hidden />
      {STATUS_LABEL[status]}
    </span>
  );
}
```

`apps/web/src/components/EmptyState.tsx`. Spec §5.1: there is deliberately no `description` prop:

```tsx
import type { ReactNode } from 'react';

export function EmptyState({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="lattice flex flex-col items-center gap-4 rounded-card border border-dashed border-border-control px-6 py-10 text-center">
      <h2 className="font-display text-display text-ink">{title}</h2>
      {action}
    </div>
  );
}
```

`apps/web/src/components/Field.tsx`. No `description` or `hint` prop. The label and the error wiring are accessibility, not copy:

```tsx
import { CircleAlert } from 'lucide-react';
import { cloneElement, useId, type ReactElement } from 'react';

export function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string | undefined;
  children: ReactElement<{ id?: string; 'aria-invalid'?: boolean; 'aria-describedby'?: string }>;
}) {
  const id = useId();
  const errorId = `${id}-error`;

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-semibold text-ink">
        {label}
      </label>
      {cloneElement(children, {
        id,
        'aria-invalid': error ? true : undefined,
        'aria-describedby': error ? errorId : undefined,
      })}
      {error ? (
        <p id={errorId} className="flex items-center gap-1.5 text-sm text-bad-fg">
          <CircleAlert className="size-3.5 shrink-0" aria-hidden />
          {error}
        </p>
      ) : null}
    </div>
  );
}
```

`apps/web/src/components/PageError.tsx`:

```tsx
export function PageError({ title }: { title: string }) {
  return (
    <div className="flex flex-col items-center gap-4 px-6 py-16 text-center">
      <h1 className="font-display text-display text-ink">{title}</h1>
    </div>
  );
}
```

- [ ] **Step 6: Verify and commit**

Run: `pnpm --filter @majlis/web test && pnpm --filter @majlis/web typecheck && pnpm --filter @majlis/web build`
Expected: PASS, clean, build succeeds.

```bash
git add apps/web
git commit -m "feat(web): component layer on Majlis tokens

shadcn primitives re-pointed at our token names so there is one palette.
EmptyState and Field ship with no description prop, which is how the copy
rule is enforced rather than reviewed."
```

---

## Task 7: Auth screens and the role redirect

**Files:**
- Create: `apps/web/src/app/(auth)/layout.tsx`, `(auth)/login/page.tsx`, `(auth)/signup/page.tsx`
- Create: `apps/web/src/components/auth/AuthForm.tsx`
- Modify: `apps/web/src/app/page.tsx`

**Interfaces:**
- Consumes: `apiFetch`, `ProblemError` (Task 3), `landingFor`, `requireUser`, `getSessionUser` (Task 5), `Field`, `Button`, `Input` (Task 6), `BRAND` (Task 2).
- Produces: nothing later tasks import.

- [ ] **Step 1: Write the root redirect**

`apps/web/src/app/page.tsx`. Spec §9.1: `/` never renders, it routes:

```tsx
import { redirect } from 'next/navigation';
import { landingFor } from '@/lib/routing';
import { getSessionUser } from '@/lib/session';

export default async function RootPage() {
  const user = await getSessionUser();
  redirect(user ? landingFor(user) : '/login');
}
```

- [ ] **Step 2: Write the auth layout**

`apps/web/src/app/(auth)/layout.tsx`. A signed-in visitor never sees a login form:

```tsx
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { landingFor } from '@/lib/routing';
import { getSessionUser } from '@/lib/session';

export default async function AuthLayout({ children }: { children: ReactNode }) {
  const user = await getSessionUser();
  if (user) redirect(landingFor(user));

  return (
    <main id="main" className="lattice grid min-h-dvh place-items-center px-5 py-10">
      <div className="w-full max-w-sm">{children}</div>
    </main>
  );
}
```

- [ ] **Step 3: Write the shared form**

`apps/web/src/components/auth/AuthForm.tsx`. Note what is absent: no tagline under the wordmark, no helper text under any field:

```tsx
'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/Field';
import { apiFetch, ProblemError } from '@/lib/api';
import { BRAND } from '@/lib/brand';
import { landingFor } from '@/lib/routing';
import type { SessionUser } from '@majlis/contracts';

export function AuthForm({ mode }: { mode: 'login' | 'signup' }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<ProblemError | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setProblem(null);

    const data = Object.fromEntries(new FormData(event.currentTarget));
    try {
      const user = await apiFetch<SessionUser>(`/auth/${mode}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(data),
      });
      router.replace(landingFor(user));
      router.refresh();
    } catch (err) {
      if (err instanceof ProblemError) {
        setProblem(err);
        if (err.errors.length === 0) toast.error(err.detail ?? err.title);
      } else {
        toast.error('Could not reach the server. Check your connection and try again.');
      }
    } finally {
      setPending(false);
    }
  }

  // A 401 from login carries no errors[], so surface it on the password field
  // where the user can act on it rather than in a toast they may miss.
  const passwordError =
    problem?.fieldError('password') ??
    (problem?.status === 401 ? 'That email and password do not match. Check them and try again.' : undefined);

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5" noValidate>
      <h1 className="font-display text-display text-ink">{BRAND.product}</h1>

      {mode === 'signup' ? (
        <Field label="Full name" error={problem?.fieldError('fullName')}>
          <Input name="fullName" autoComplete="name" required />
        </Field>
      ) : null}

      <Field label="University email" error={problem?.fieldError('email')}>
        <Input name="email" type="email" autoComplete="email" required />
      </Field>

      <Field label="Password" error={passwordError}>
        <Input
          name="password"
          type="password"
          autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          required
        />
      </Field>

      <Button type="submit" disabled={pending}>
        {mode === 'login' ? 'Sign in' : 'Create account'}
      </Button>
    </form>
  );
}
```

- [ ] **Step 4: Write the two pages**

`apps/web/src/app/(auth)/login/page.tsx`:

```tsx
import type { Metadata } from 'next';
import { AuthForm } from '@/components/auth/AuthForm';

export const metadata: Metadata = { title: 'Sign in' };

export default function LoginPage() {
  return <AuthForm mode="login" />;
}
```

`apps/web/src/app/(auth)/signup/page.tsx`:

```tsx
import type { Metadata } from 'next';
import { AuthForm } from '@/components/auth/AuthForm';

export const metadata: Metadata = { title: 'Create account' };

export default function SignupPage() {
  return <AuthForm mode="signup" />;
}
```

- [ ] **Step 5: Verify manually against the real API**

With Postgres running and the database seeded:

```bash
pnpm --filter @majlis/api start:dev   # terminal 1
pnpm --filter @majlis/web dev         # terminal 2
```

Confirm each, and report any that fail:

1. `http://localhost:3000/` redirects to `/login`.
2. `admin@uni.ac.ae` / `Passw0rd!` lands on `/admin`.
3. `student@uni.ac.ae` / `Passw0rd!` lands on `/home`.
4. A wrong password shows the message under the password field, not a toast.
5. Visiting `/login` while signed in redirects away.

Routes `/admin` and `/home` do not exist until Tasks 8 and 9, so expect a 404 after the redirect. The redirect target in the URL bar is what is being checked.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app apps/web/src/components/auth
git commit -m "feat(web): sign in, sign up, role redirect

/ routes by role and never renders. Field errors come from the API's
errors[] array; a 401 surfaces on the password field."
```

---

## Task 8: Student shell

**Files:**
- Create: `apps/web/src/components/shell/StudentShell.tsx`, `TabBar.tsx`
- Create: `apps/web/src/app/(student)/layout.tsx`
- Create: `apps/web/src/app/(student)/{home,clubs,events}/page.tsx`
- Create: `apps/web/src/app/(student)/me/page.tsx`, `me/qr/page.tsx`, `me/registrations/page.tsx`, `me/certificates/page.tsx`

**Interfaces:**
- Consumes: `requireUser` (Task 5), `EmptyState` (Task 6), `ThemeToggle` (Task 2).
- Produces: `<StudentShell title={...}>` used by every route in this group.

- [ ] **Step 1: Write the tab bar**

`apps/web/src/components/shell/TabBar.tsx`. Five tabs, each a 64×56 target. The active tab carries colour, weight **and** an indicator bar, so state is never colour alone:

```tsx
'use client';

import { CalendarDays, House, QrCode, User, Users } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/cn';

const TABS = [
  { href: '/home', label: 'Home', icon: House },
  { href: '/clubs', label: 'Clubs', icon: Users },
  { href: '/events', label: 'Events', icon: CalendarDays },
  { href: '/me/qr', label: 'My QR', icon: QrCode },
  { href: '/me', label: 'Me', icon: User },
] as const;

export function TabBar() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Sections"
      className="grid grid-cols-5 border-t border-border bg-surface pb-[var(--safe-b)]"
    >
      {TABS.map(({ href, label, icon: Icon }) => {
        // /me must not light up while on /me/qr, so the deepest match wins.
        const active =
          pathname === href || (href !== '/me' && pathname.startsWith(`${href}/`));
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'relative flex min-h-14 flex-col items-center justify-center gap-0.5 text-label',
              active ? 'font-semibold text-primary' : 'text-ink-3',
            )}
          >
            {active ? (
              <span className="absolute inset-x-[22%] top-0 h-0.5 rounded-b bg-primary" aria-hidden />
            ) : null}
            <Icon className="size-5" aria-hidden />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
```

- [ ] **Step 2: Write the shell**

`apps/web/src/components/shell/StudentShell.tsx`. The `100dvh` three-row grid, safe-area padding and overscroll containment are spec §9.3:

```tsx
import type { ReactNode } from 'react';
import { ThemeToggle } from '@/components/ThemeToggle';
import { TabBar } from './TabBar';

export function StudentShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="grid h-dvh grid-rows-[auto_1fr_auto] overflow-hidden bg-bg">
      <header className="flex items-center justify-between gap-3 border-b border-border px-4 pb-3 pt-[calc(0.75rem+var(--safe-t))]">
        <h1 className="font-display text-title text-ink">{title}</h1>
        <ThemeToggle />
      </header>

      <main id="main" className="overflow-y-auto overscroll-contain px-4 py-4">
        {children}
      </main>

      <TabBar />
    </div>
  );
}
```

- [ ] **Step 3: Write the layout**

`apps/web/src/app/(student)/layout.tsx`. Re-verifies server-side, redirects rather than rendering a panel:

```tsx
import type { ReactNode } from 'react';
import { requireUser } from '@/lib/session';

export default async function StudentLayout({ children }: { children: ReactNode }) {
  await requireUser();
  return children;
}
```

- [ ] **Step 4: Write the seven routes**

Each is the same shape. Headline plus action, no explanatory paragraph. `apps/web/src/app/(student)/home/page.tsx`:

```tsx
import type { Metadata } from 'next';
import { EmptyState } from '@/components/EmptyState';
import { StudentShell } from '@/components/shell/StudentShell';

export const metadata: Metadata = { title: 'Home' };

export default function HomePage() {
  return (
    <StudentShell title="Home">
      <EmptyState title="Nothing here yet" />
    </StudentShell>
  );
}
```

Repeat for the remaining six, changing only `metadata.title`, the `StudentShell` title and the `EmptyState` title:

| File | Shell title | Empty title |
|---|---|---|
| `clubs/page.tsx` | `Clubs` | `No clubs yet` |
| `events/page.tsx` | `Events` | `No events yet` |
| `me/page.tsx` | `Me` | `Nothing here yet` |
| `me/qr/page.tsx` | `My QR` | `Your pass arrives in Stage 6` |
| `me/registrations/page.tsx` | `My registrations` | `Nothing booked yet` |
| `me/certificates/page.tsx` | `My certificates` | `No certificates yet` |

- [ ] **Step 5: Verify manually**

Run both dev servers, sign in as `student@uni.ac.ae`, and confirm at a 390×844 viewport in device emulation:

1. The tab bar is fixed and the content region scrolls under it.
2. Tapping each tab changes the active indicator with no layout shift.
3. `/me/qr` highlights "My QR", not "Me".
4. Both themes render correctly through the toggle.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app apps/web/src/components/shell
git commit -m "feat(web): student shell with bottom tabs

100dvh three-row grid, safe-area insets, overscroll containment. Active tab
carries an indicator bar as well as colour."
```

---

## Task 9: Console shells for officer and admin

**Files:**
- Create: `apps/web/src/components/shell/ConsoleShell.tsx`, `SideNav.tsx`
- Create: `apps/web/src/app/(club)/manage/[clubId]/layout.tsx` and six pages
- Create: `apps/web/src/app/(admin)/admin/layout.tsx` and seven pages

**Interfaces:**
- Consumes: `requireUser` (Task 5), `EmptyState`, `PageError` (Task 6), `Sheet` (Task 6).
- Produces: `<ConsoleShell nav={...} title={...} context={...}>`.

- [ ] **Step 1: Write the side nav**

`apps/web/src/components/shell/SideNav.tsx`:

```tsx
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ComponentType } from 'react';
import { cn } from '@/lib/cn';

export type NavItem = { href: string; label: string; icon: ComponentType<{ className?: string }> };

export function SideNav({ items }: { items: readonly NavItem[] }) {
  const pathname = usePathname();

  return (
    <nav aria-label="Sections" className="flex flex-col gap-0.5">
      {items.map(({ href, label, icon: Icon }) => {
        const active = pathname === href;
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex items-center gap-2.5 rounded-control px-2.5 py-2 text-sm',
              active ? 'bg-primary-soft font-semibold text-primary-soft-fg' : 'text-ink-2 hover:bg-surface-2',
            )}
          >
            <Icon className="size-4 shrink-0" aria-hidden />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
```

- [ ] **Step 2: Write the console shell**

`apps/web/src/components/shell/ConsoleShell.tsx`. Sidebar collapses to a sheet below 1024px:

```tsx
import { Menu } from 'lucide-react';
import type { ReactNode } from 'react';
import { ThemeToggle } from '@/components/ThemeToggle';
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { SideNav, type NavItem } from './SideNav';

export function ConsoleShell({
  items,
  title,
  context,
  children,
}: {
  items: readonly NavItem[];
  title: string;
  context: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="min-h-dvh bg-bg lg:grid lg:grid-cols-[13rem_1fr]">
      <aside className="hidden border-r border-border bg-surface-2 p-3 lg:flex lg:flex-col lg:gap-3">
        {context}
        <SideNav items={items} />
      </aside>

      <div className="flex min-w-0 flex-col">
        <header className="flex items-center gap-3 border-b border-border px-4 py-3 lg:px-6">
          <Sheet>
            <SheetTrigger
              aria-label="Open navigation"
              className="grid size-11 place-items-center rounded-control text-ink-2 hover:bg-surface-2 lg:hidden"
            >
              <Menu className="size-5" aria-hidden />
            </SheetTrigger>
            <SheetContent side="left" className="w-64 bg-surface-2 p-3">
              <SheetTitle className="sr-only">Navigation</SheetTitle>
              <div className="flex flex-col gap-3">
                {context}
                <SideNav items={items} />
              </div>
            </SheetContent>
          </Sheet>

          <h1 className="min-w-0 flex-1 truncate font-display text-title text-ink">{title}</h1>
          <ThemeToggle />
        </header>

        <main id="main" className="min-w-0 flex-1 px-4 py-5 lg:px-6">
          {children}
        </main>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Write the officer layout with its authorization check**

`apps/web/src/app/(club)/manage/[clubId]/layout.tsx`. Club roles are re-derived from `/auth/me` on every request, never from the URL:

```tsx
import type { ReactNode } from 'react';
import { PageError } from '@/components/PageError';
import { requireUser } from '@/lib/session';

export default async function ManageLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ clubId: string }>;
}) {
  const { clubId } = await params;
  const user = await requireUser();

  // Re-derived from the database on every request. A club ID in the URL is a
  // claim, never a permission (spec 11).
  const holdsRole = user.clubRoles.some((r) => r.clubId === clubId);
  if (!holdsRole && user.platformRole !== 'ADMIN') {
    return <PageError title="You do not have access to this club" />;
  }

  return children;
}
```

- [ ] **Step 4: Write the officer pages**

`apps/web/src/app/(club)/manage/[clubId]/overview/page.tsx`:

```tsx
import { CalendarDays, LayoutGrid, ScanLine, Shield, Trophy, Users } from 'lucide-react';
import type { Metadata } from 'next';
import { EmptyState } from '@/components/EmptyState';
import { ConsoleShell } from '@/components/shell/ConsoleShell';

export const metadata: Metadata = { title: 'Overview' };

export default async function OverviewPage({ params }: { params: Promise<{ clubId: string }> }) {
  const { clubId } = await params;
  const base = `/manage/${clubId}`;
  const items = [
    { href: `${base}/overview`, label: 'Overview', icon: LayoutGrid },
    { href: `${base}/members`, label: 'Members', icon: Users },
    { href: `${base}/team`, label: 'Team', icon: Shield },
    { href: `${base}/events`, label: 'Events', icon: CalendarDays },
    { href: `${base}/scan`, label: 'Scan', icon: ScanLine },
    { href: `${base}/certificates`, label: 'Certificates', icon: Trophy },
  ] as const;

  return (
    <ConsoleShell items={items} title="Overview" context={null}>
      <EmptyState title="Nothing here yet" />
    </ConsoleShell>
  );
}
```

Repeat for `members`, `team`, `events`, `scan` and `certificates`, changing only `metadata.title`, the `ConsoleShell` title and the `EmptyState` title. The `items` array is identical in each; extract it to `apps/web/src/app/(club)/manage/[clubId]/nav.ts` and import it rather than repeating it six times:

```ts
import { CalendarDays, LayoutGrid, ScanLine, Shield, Trophy, Users } from 'lucide-react';

export function clubNav(clubId: string) {
  const base = `/manage/${clubId}`;
  return [
    { href: `${base}/overview`, label: 'Overview', icon: LayoutGrid },
    { href: `${base}/members`, label: 'Members', icon: Users },
    { href: `${base}/team`, label: 'Team', icon: Shield },
    { href: `${base}/events`, label: 'Events', icon: CalendarDays },
    { href: `${base}/scan`, label: 'Scan', icon: ScanLine },
    { href: `${base}/certificates`, label: 'Certificates', icon: Trophy },
  ] as const;
}
```

Add `apps/web/src/app/(club)/manage/[clubId]/page.tsx` redirecting to `overview`:

```tsx
import { redirect } from 'next/navigation';

export default async function ManageIndex({ params }: { params: Promise<{ clubId: string }> }) {
  const { clubId } = await params;
  redirect(`/manage/${clubId}/overview`);
}
```

- [ ] **Step 5: Write the admin layout and pages**

`apps/web/src/app/(admin)/admin/layout.tsx`:

```tsx
import type { ReactNode } from 'react';
import { PageError } from '@/components/PageError';
import { requireUser } from '@/lib/session';

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();
  if (user.platformRole !== 'ADMIN') {
    return <PageError title="You do not have access to the admin console" />;
  }
  return children;
}
```

`apps/web/src/app/(admin)/admin/nav.ts`:

```ts
import { Building2, CalendarDays, Download, LayoutGrid, Shield, User, Users } from 'lucide-react';

export const ADMIN_NAV = [
  { href: '/admin/metrics', label: 'Metrics', icon: LayoutGrid },
  { href: '/admin/users', label: 'Users', icon: User },
  { href: '/admin/departments', label: 'Departments', icon: Building2 },
  { href: '/admin/clubs', label: 'Clubs', icon: Users },
  { href: '/admin/events', label: 'Events', icon: CalendarDays },
  { href: '/admin/audit', label: 'Audit', icon: Shield },
  { href: '/admin/exports', label: 'Exports', icon: Download },
] as const;
```

`apps/web/src/app/(admin)/admin/page.tsx`:

```tsx
import { redirect } from 'next/navigation';

export default function AdminIndex() {
  redirect('/admin/metrics');
}
```

Then one page per nav entry, each following the `metrics` shape:

```tsx
import type { Metadata } from 'next';
import { EmptyState } from '@/components/EmptyState';
import { ConsoleShell } from '@/components/shell/ConsoleShell';
import { ADMIN_NAV } from '../nav';

export const metadata: Metadata = { title: 'Metrics' };

export default function MetricsPage() {
  return (
    <ConsoleShell items={ADMIN_NAV} title="Metrics" context={null}>
      <EmptyState title="Nothing here yet" />
    </ConsoleShell>
  );
}
```

- [ ] **Step 6: Verify the authorization boundary manually**

Sign in as `student@uni.ac.ae` and visit `/admin/metrics`. Expect the access message, not the dashboard. Then visit `/manage/<any-uuid>/overview` and expect the same. This is the IDOR case from spec §12; the check must hold with a club ID the user knows but does not belong to.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/app apps/web/src/components/shell
git commit -m "feat(web): officer and admin console shells

One shell, two nav sets, so the consoles never read as different products.
Club roles are re-derived from /auth/me per request; a club ID in the URL
is a claim, not a permission."
```

---

## Task 10: PWA, Playwright with axe, CI

**Files:**
- Create: `apps/web/public/manifest.webmanifest`, `public/sw.js`, `public/icons/icon-192.png`, `icon-512.png`, `icon-maskable-512.png`
- Create: `apps/web/src/components/RegisterSW.tsx`
- Create: `apps/web/playwright.config.ts`, `apps/web/e2e/auth.spec.ts`, `e2e/a11y.spec.ts`
- Modify: `apps/web/src/app/layout.tsx`, `.github/workflows/*.yml`

- [ ] **Step 1: Author the icon and generate the PNGs**

Create `apps/web/public/icons/mark.svg`, an interlocking octagon drawn from the lattice motif, on the brand field:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="#0E5F55"/>
  <g fill="none" stroke="#F3EFE7" stroke-width="26" stroke-linejoin="round">
    <path d="M256 116 396 256 256 396 116 256Z"/>
    <path d="M176 176h160v160H176Z"/>
  </g>
</svg>
```

Generate the three PNGs. The maskable icon needs the safe zone, so render the mark at 60% inside the 512 canvas:

```bash
cd apps/web/public/icons
pnpm dlx sharp-cli@5.1.0 -i mark.svg -o icon-512.png resize 512 512
pnpm dlx sharp-cli@5.1.0 -i mark.svg -o icon-192.png resize 192 192
pnpm dlx sharp-cli@5.1.0 -i mark.svg -o icon-maskable-512.png resize 512 512
```

If `sharp-cli` is unavailable offline, report it rather than shipping a placeholder, and note it as blocked.

- [ ] **Step 2: Write the manifest and service worker**

`apps/web/public/manifest.webmanifest`:

```json
{
  "name": "Majlis",
  "short_name": "Majlis",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#FAF7F2",
  "theme_color": "#0E5F55",
  "icons": [
    { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png" },
    { "src": "/icons/icon-maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
```

`apps/web/public/sw.js`. This exists only because Chrome requires a fetch handler to offer the install prompt. Spec §9.3 forbids offline caching, and scanning requires connectivity:

```js
// Install-prompt requirement only. Caches nothing on purpose: Majlis has no
// offline mode, and a stale cached shell would show wrong capacity numbers.
self.addEventListener('fetch', () => {});
```

`apps/web/src/components/RegisterSW.tsx`:

```tsx
'use client';

import { useEffect } from 'react';

export function RegisterSW() {
  useEffect(() => {
    if ('serviceWorker' in navigator) void navigator.serviceWorker.register('/sw.js');
  }, []);
  return null;
}
```

Add `manifest: '/manifest.webmanifest'` to the `metadata` export in `apps/web/src/app/layout.tsx`, and render `<RegisterSW />` inside `<ThemeProvider>`.

- [ ] **Step 3: Write the Playwright config**

`apps/web/playwright.config.ts`:

```ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  use: { baseURL: 'http://localhost:3000', trace: 'on-first-retry' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:3000/login',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
```

- [ ] **Step 4: Write the E2E specs**

`apps/web/e2e/auth.spec.ts`:

```ts
import { expect, test } from '@playwright/test';

const PASSWORD = 'Passw0rd!';

async function signIn(page: import('@playwright/test').Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('University email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

test('/ redirects an anonymous visitor to /login', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/login$/);
});

test('an admin lands on /admin', async ({ page }) => {
  await signIn(page, 'admin@uni.ac.ae');
  await expect(page).toHaveURL(/\/admin\/metrics$/);
});

test('a student lands on /home', async ({ page }) => {
  await signIn(page, 'student@uni.ac.ae');
  await expect(page).toHaveURL(/\/home$/);
});

test('a student is refused the admin console', async ({ page }) => {
  // The IDOR case from spec 12. Hiding the link is presentation, never
  // protection, so this navigates directly.
  await signIn(page, 'student@uni.ac.ae');
  await page.goto('/admin/metrics');
  await expect(page.getByRole('heading', { name: /do not have access/i })).toBeVisible();
});

test('a wrong password reports on the field, and the page never renders a shell', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('University email').fill('student@uni.ac.ae');
  await page.getByLabel('Password').fill('wrong-password-here');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText(/do not match/i)).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);
});

test('an expired session is refreshed on navigation rather than bounced', async ({ page, context }) => {
  // The defect Task 4 exists to fix. Clearing only the session cookie models
  // 15 minutes of idling; the 30-day refresh cookie stays.
  await signIn(page, 'student@uni.ac.ae');
  const kept = (await context.cookies()).filter((c) => c.name !== 'majlis_session');
  await context.clearCookies();
  await context.addCookies(kept);

  await page.goto('/events');
  await expect(page).toHaveURL(/\/events$/);
  await expect(page.getByRole('heading', { name: 'Events' })).toBeVisible();
});

test('signing in on a phone viewport shows the tab bar', async ({ page }) => {
  await signIn(page, 'student@uni.ac.ae');
  await expect(page.getByRole('navigation', { name: 'Sections' })).toBeVisible();
  await page.getByRole('link', { name: 'My QR' }).click();
  await expect(page.getByRole('link', { name: 'My QR' })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('link', { name: 'Me', exact: true })).not.toHaveAttribute('aria-current', 'page');
});
```

`apps/web/e2e/a11y.spec.ts`:

```ts
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const PASSWORD = 'Passw0rd!';

async function signIn(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('University email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'));
}

async function scan(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(results.violations).toEqual([]);
}

for (const theme of ['light', 'dark'] as const) {
  test.describe(`${theme} theme`, () => {
    test.beforeEach(async ({ page }) => {
      await page.emulateMedia({ colorScheme: theme });
    });

    test('login has no violations', async ({ page }) => {
      await page.goto('/login');
      await scan(page);
    });

    test('student shell has no violations', async ({ page }) => {
      await signIn(page, 'student@uni.ac.ae');
      await scan(page);
    });

    test('admin console has no violations', async ({ page }) => {
      await signIn(page, 'admin@uni.ac.ae');
      await scan(page);
    });
  });
}

test('sign-in is reachable by keyboard alone', async ({ page }) => {
  // Catches a custom control that is clickable but not focusable, which every
  // mouse-driven check passes.
  await page.goto('/login');
  await page.keyboard.press('Tab'); // skip link
  await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
  await page.getByLabel('University email').focus();
  await page.keyboard.type('student@uni.ac.ae');
  await page.keyboard.press('Tab');
  await page.keyboard.type(PASSWORD);
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/home$/);
});
```

- [ ] **Step 5: Install browsers and run**

```bash
pnpm --filter @majlis/web exec playwright install --with-deps chromium
pnpm --filter @majlis/api start:dev    # terminal 1, plus a seeded database
pnpm --filter @majlis/web test:e2e     # terminal 2
```

Expected: all PASS. **If axe reports violations, fix the markup.** Do not narrow the tag list or add exclusions to make the suite green; that converts verification back into assertion, which spec §9.5 rejects.

- [ ] **Step 6: Wire CI**

Add a `web` job to the existing workflow in `.github/workflows/`, running after the API job, with the `postgres:18` service container the API job already uses:

```yaml
  web:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v5
        with:
          node-version-file: .nvmrc
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter @majlis/web typecheck
      - run: pnpm --filter @majlis/web lint
      - run: pnpm --filter @majlis/web test
      - run: pnpm --filter @majlis/web build
```

Match the existing job's step style rather than this sketch where the two differ. Leave Playwright out of CI for now: it needs a running API and a seeded database, which Stage 9 wires up alongside deployment.

- [ ] **Step 7: Full verification**

```bash
pnpm typecheck && pnpm lint && pnpm test
pnpm --filter @majlis/api test:integration
pnpm build
pnpm --filter @majlis/web test:e2e
```

Report the actual output. If anything fails, say so with the output rather than describing it as passing.

- [ ] **Step 8: Commit**

```bash
git add apps/web .github
git commit -m "feat(web): PWA manifest, axe E2E suite, CI job

Service worker exists only for the install prompt and caches nothing.
Axe runs over three shells in both themes at two viewports."
```

---

## Closing the stage

- [ ] Run `/code-review` over the full diff.
- [ ] Run `/security-review` again if anything beyond Task 4 touched auth.
- [ ] Tick Stage 3 in `docs/specs/2026-09-10-majlis-design.md` §13 and record any deviation not already in the Stage 3 spec §10.
- [ ] Delete `handoff.md` once its gaps are reconciled into the permanent docs, or rewrite it for Stage 4.
- [ ] Use `superpowers:finishing-a-development-branch`.

---

## Self-review notes

**Spec coverage.** §1 scope maps to Tasks 1 through 10. §2.1 palette to Task 1. §2.2 type to Tasks 1 and 2. §2.3 tokens to Task 1. §2.4 motif to Task 1 (`@utility lattice`), used in Tasks 6 and 7. §3 structure to Tasks 7, 8, 9. §4.1 cookie path to Task 4. §4.2 routing to Task 5. §4.3 sign-in to Task 7. §5 components to Task 6. §5.1 copy rule is a Global Constraint and is enforced by the absent props in Task 6. §6 API client to Task 3. §7 PWA to Task 10. §8 accessibility to Tasks 1, 2, 6, 10. §9 testing to Tasks 1, 3, 5, 6, 10.

**Known gaps, deliberate.** The identity board shows a QR pass card and a date-rail event list. Neither is built in Stage 3, because there is no pass and no event to render. They are the reference for Stages 5 and 6, not work items here. `lib/theme.ts` appears in the spec's file table but `next-themes` supplies it, so no such file is created.
