# Prompt for the next session

Copy everything below the line into a fresh Claude Code session at `C:\Users\Osama\Desktop\majlis-v2`.

---

You're picking up Majlis, a university club and event management system, at
C:\Users\Osama\Desktop\majlis-v2. Stages 1 (foundation) and 2 (auth & users) are
complete and merged to master. 125 unit tests, 174 integration tests against real
PostgreSQL 18, all green.

Read `handoff.md` first, then `docs/specs/2026-09-10-majlis-design.md` — §9 is the
frontend brief and §13 has the stage plan. CLAUDE.md is already in your context;
follow it, especially the toolchain traps. Do not read `../majlis` — that's an
abandoned build and its CLAUDE.md is confidently wrong about this stack.

**Next is Stage 3: design system & shells.** The plan is now 9 stages, not 12 — the
old 4+5, 6+7 and 10+11 were merged. No feature was dropped.

Stage 3 builds `apps/web` from nothing: Next.js 16 App Router, the visual identity
(palette, type ramp, tokens, dark mode), the shadcn component layer, and the three
shells — student mobile-first with bottom tabs, club officer console, admin desktop
dashboard. Plus role-based routing off `GET /api/v1/auth/me`, the PWA manifest, and
the accessibility baseline. The spec deliberately left the visual identity undecided
so it could be judged against real screens — so present it to me before building out.

Things that matter for this stage specifically:

- Auth is httpOnly cookies; the browser never sees a token. A Next.js rewrite maps
  `/api/v1/*` to the API so it's same-origin and there's no CORS at all. On a 401,
  refresh once and retry — no client-side dedupe needed, the token doesn't rotate.
- `/` redirects by role. Never render a page and then show an "authentication
  required" panel inside it.
- WCAG 2.2 AA is the target and must be verified, not asserted. A palette that fails
  contrast gets rejected at design time, not patched later.
- The student shell must read as an application, not a website — safe-area insets,
  100dvh handling, sheet modals, 44px tap targets, no layout shift on navigation.

Use the frontend skills before building screens, not as a review afterwards:
`impeccable:impeccable`, `taste-skill:brandkit` for the identity,
`taste-skill:imagegen-frontend-mobile` for the student shell, and
`ui-ux-pro-max:ui-ux-pro-max` for planning and shadcn component search.

**On pace — this matters.** Stage 2 took about six hours and that was too long. The
rigor caught six real defects, but cost four agent dispatches per task across twelve
tasks, many of them fix rounds over comment wording. For this stage: one review per
task, not review-plus-fix-plus-re-review. Batch small same-shape work into one
dispatch. Keep code comments to a line or two. Keep commit messages to a subject plus
two or three lines. Keep your replies to me short — lead with the answer.

What doesn't get traded away: tests that discriminate, invariants in the database, and
a security review before anything touching auth, tokens or permissions lands. The
speed comes out of ceremony, not out of correctness.

The recurring defect across both stages has been tests that pass against badly broken
code — Stage 2's review caught one on nine of twelve tasks. Before trusting a test,
name the broken implementation it would catch.

Brainstorm the visual direction with me before planning, plan before building, and
execute with subagent-driven development. Tell me plainly when something doesn't go as
planned, and ask before removing a constraint, a test, or a transaction boundary.
