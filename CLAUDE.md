# Majlis — Agent Instructions

Majlis is a real production system for university club and event management: club
governance, membership, events, registrations, QR check-in, and certificate
automation. Build it to run in production, with real security and data-integrity
guarantees — not as a demo.

## Read order

1. **`handoff.md`** if it exists — where the previous session left off. Reconcile it
   into the permanent docs and delete it once you have.
2. **`docs/specs/2026-09-10-majlis-design.md`** — the binding authority. Its §3 is a
   decisions ledger; §13 tracks stage progress and records every deviation.
3. The current stage's plan in `docs/superpowers/plans/`.

**Never read `../majlis`.** That is the abandoned previous build. Its `CLAUDE.md` is
detailed and now actively wrong — different stack (Hono / Cloudflare Workers /
Drizzle), and it states that certificate verification and QR rotation don't exist,
when both exist here.

## Skills to use

Announce the skill when you invoke it. These aren't optional garnish — this project
was built with them and expects them.

**Every piece of work, in this order:**

| When | Skill |
|---|---|
| Before any feature, change, or new component | `superpowers:brainstorming` |
| Turning an approved design into tasks | `superpowers:writing-plans` |
| Executing a plan | `superpowers:subagent-driven-development` (preferred) or `superpowers:executing-plans` |
| Writing any implementation | `superpowers:test-driven-development` |
| Any bug, test failure, or surprise | `superpowers:systematic-debugging` — before proposing a fix |
| Before claiming anything works | `superpowers:verification-before-completion` |
| Finishing a branch | `superpowers:finishing-a-development-branch` |

One plan per stage, not one plan for the whole build.

**Frontend work — Stage 3 onward.** Invoke these *before* building screens, not as a
review afterwards:

- `impeccable:impeccable` — the main one. Layout, hierarchy, accessibility,
  responsive behaviour, motion, empty and error states, design tokens.
- `ui-ux-pro-max:ui-ux-pro-max` — planning and review passes; it also integrates the
  shadcn/ui MCP for component search, which matters since this project uses shadcn.
- `taste-skill:brandkit` — Stage 3's visual identity. The spec deliberately leaves
  palette, type ramp and visual language undecided so they can be judged against real
  screens.
- `taste-skill:imagegen-frontend-mobile` — the student shell is mobile-first and must
  read as an application, not a website.
- `taste-skill:taste-skill` — baseline anti-generic pass if the above aren't enough.
- `dataviz` — **before** writing any chart for the admin dashboard (Stage 11).
- `web-perf` — Core Web Vitals, once there are real screens.

**Quality gates:** `/code-review` before merging a stage, `/simplify` for a
clean-up pass, `/security-review` before anything touching auth, tokens, or
permissions lands.

**Do not use the Cloudflare skills** (`nextjs-on-cloudflare`, `workers-*`,
`wrangler`, `durable-objects`, `migrate-to-vinext`, and the rest). They applied to
the abandoned build. This project deploys to **Vercel**.

## Ground rules

- **Build in stages, in order** (spec §13). A stage is done when migrations run,
  endpoints are tested, and screens work — not before. Tick it off in §13 and record
  any deviation there.
- **Invariants live in the database.** One active membership per (user, club), one
  active registration per (user, event), capacity never exceeded, one active
  certificate per eligible registration. Partial unique indexes, `CHECK` constraints,
  transactions — not application checks. Add the SQL by hand and write a test that
  fails without it.
- **Write tests that discriminate.** The most common defect in Stage 1 was tests that
  pass against a badly broken implementation — index tests using a single user, a
  redaction test matching a substring, seed tests counting rows without checking
  *which* rows. Before trusting a test, name the broken implementation it would
  catch. If you can't, it isn't testing anything. Proving it by deliberately breaking
  the code and watching it go red is cheap and worth doing.
- **Server-side authorization on every protected endpoint.** Re-derive permissions
  from the database on every request. Never trust a client-supplied role, club ID, or
  ownership claim. Hiding a control in the UI is presentation, never protection.
- **Every state transition goes through the entity's transition function.** No ad-hoc
  status writes.
- **Write through `TransactionHost`, never `PrismaService` directly.** `host.tx`
  returns the ambient transaction; `host.run(fn)` starts one or joins the caller's.
  This is what makes "the audit row is written in the same transaction as the action"
  structural rather than something you must remember.
- **Services throw `DomainError` subclasses** (`NotFoundError`, `ForbiddenError`,
  `ConflictError`, `UnprocessableError`), never `@nestjs/common` exceptions. The
  global filter renders RFC 9457 Problem Details.
- **Audit sensitive actions** — approvals, role changes, scans, issuance, admin
  overrides — in the same transaction as the action.
- **No secrets in code or logs.** No raw QR token, password, or session token is
  stored or logged anywhere.
- **OpenAPI is generated from code**, never hand-written. Zod schemas in
  `packages/contracts` are the single source of truth.
- **English only.** No localisation fields.

## Toolchain traps

Each of these is verified behaviour that cost a session to discover.

- **`@nestjs/cli` is deliberately absent.** 12.0.0 is the only stable 12.x and it
  cannot run at all — even `nest --version` dies, because it pins ESM-only
  `ora@9.4.1` while `@angular-devkit/schematics` `require()`s it in a cycle. `build`
  is `tsc`. Do not reinstall it.
- **The dev loop is SWC, not `tsx`.** esbuild does not implement
  `emitDecoratorMetadata`, so `tsx` silently breaks NestJS constructor injection.
  `tsx` stays only for `db:seed`, which has no DI.
- **Prisma 7:** the `datasource` block takes `provider` only — a `url` there is a hard
  `P1012` error. Connection strings live in `apps/api/prisma.config.ts`. `migrate dev`
  does **not** auto-run `generate`.
- **Every enum needs `@@map`.** Adding one after the enum's creating migration
  produces a destructive `DROP TYPE` plus column rewrite.
- **Use the `API_PREFIX` constant.** Its leading slash is load-bearing: without it,
  `registerNotFoundHandler` skips normalisation and 404s bypass every exception
  filter, silently.
- **pnpm 11 refuses packages published in the last 24 hours.** Never pin anything
  newer than ~48 hours, and never add a `minimumReleaseAgeExclude` to bypass it.
  **Verify every version exists on npm before pinning** — the Stage 1 plan contained
  several that never did.
- **`user` is a reserved word in Postgres.** Quote it in raw SQL.
- Hand-written SQL appended to a generated migration is **not** treated as drift by a
  later `migrate dev`. Verified. Keep using `--create-only` then appending.

## Decisions already made — do not re-litigate without asking

Full ledger with reasoning in spec §3. The ones most easily reversed by accident:

- **Stack:** NestJS 12 + Prisma 7 + Supabase Postgres + Next.js 16, Tailwind v4 +
  shadcn/ui, Zod 4 contracts, pnpm + Turborepo. Deployed entirely on **Vercel**.
- **No approval workflow anywhere.** Admin creates club → active. Lead publishes
  event → live. No pending states, no `ApprovalDecision` entity.
- **One QR pass per user**, not per registration — identity only, no event data.
  Rotation exists.
- **Public certificate verification exists** (`/verify/{code}`).
- **Subjects get foreign keys; actors do not.** The record of who did something must
  outlive their account. `AuditLog` has no foreign keys at all and is append-only via
  statement-level triggers.
- **Three app shells:** student (mobile-first, bottom tabs), club officer, admin
  (desktop dashboard). Login routes by role. No landing page.
- **Installable PWA, but no offline support.** Scanning requires connectivity.
- **Single university. English only.** Timestamps stored UTC; events render in the
  venue's timezone with the viewer's as secondary.
- **No queue.** Background work is plain code; the event lifecycle is lazy.

## Working style

Report outcomes faithfully. If tests fail, say so with the output. If you deviate
from a plan or brief, **lead with the deviation** — a deviation nobody knows about is
worse than a task that comes back blocked. When an instruction turns out to be wrong,
say so rather than working around it silently.
