# Stage 1 — Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the Majlis monorepo with a complete, constraint-enforced Prisma schema, a running NestJS API with health/logging/error-handling infrastructure, a real-Postgres integration test harness, an idempotent seed script, and CI.

**Architecture:** pnpm workspace + Turborepo containing `apps/api` (NestJS 12, CommonJS) and `packages/contracts` (Zod 4 schemas shared as the single source of truth). Prisma 7 talks to Postgres 18 through the mandatory `@prisma/adapter-pg` driver adapter, generating a CJS client into `apps/api/src/generated/prisma`. Every database invariant from the spec is written as a partial unique index, `CHECK` constraint, or trigger in hand-authored migration SQL — because the invariants *are* the constraints, integration tests run against a real Postgres, never a mock.

**Tech Stack:** NestJS 12.0.1 · Prisma 7.10.0 + `@prisma/adapter-pg` · Postgres 18 · Zod 4.6.1 · nestjs-zod 5.5.0 · nestjs-pino 5.1.0 · Vitest 5.0.0 · Turborepo 2.10.12 · Node 22.14 · pnpm 11.15

**Spec:** `docs/specs/2026-09-10-majlis-design.md`

## Global Constraints

- **Pin every version exactly.** Never `latest`. ⚠️ `prisma@latest` currently resolves to `8.0.0-rc.13`, a release candidate — the Prisma packages pin to **7.10.0**.
- **Never pin a package published in the last 48 hours.** pnpm 11 enforces a default 24-hour `minimumReleaseAge` supply-chain policy and refuses the install outright. **Do not add a `minimumReleaseAgeExclude` entry to work around it** — that bypass exists for emergencies, not for chasing a fresh release. Pick an older patch instead. This is why `zod` pins to `4.5.4` rather than the newer `4.6.1`.
- **CommonJS, not ESM.** Prisma 7's generator defaults to ESM; the generator block must set `moduleFormat = "cjs"`. Do not add `"type": "module"` to `apps/api/package.json`.
- Prisma 7 requires a **driver adapter** (`@prisma/adapter-pg`) and an explicit **`output`** path on the generator. It no longer auto-runs `generate` or `seed`.
- **Hand-written migration SQL survives later migrations.** Tasks 5–9 each append partial unique indexes and CHECK constraints that Prisma cannot express in `schema.prisma`. Verified empirically against `prisma.10.0`: a subsequent `migrate dev` does **not** treat them as drift and does **not** generate drops for them — the next migration contains only the genuinely new objects. Layering constraints this way is safe.
- **IDs are UUID v7** via Prisma's `@default(uuid(7))` — generated client-side, so it works regardless of the server's Postgres version. Do not use Postgres 18's native `uuidv7()`; Supabase may be on an older major.
- **All timestamps are `timestamptz`, stored UTC.** In Prisma: `@db.Timestamptz(3)`.
- **No unbounded list queries anywhere**, in any code, ever.
- **Never log or persist** a raw QR token, password, session token, or refresh token.
- **English only.** No localisation fields.
- Database object naming is `snake_case` (via `@@map` / `@map`); TypeScript is `camelCase`.
- **Enums need `@@map` too.** Without one, Prisma emits a PascalCase Postgres type (`"UserStatus"`) sitting beside snake_case tables, and every raw-SQL reference to it then needs double-quoting to survive case-folding. Every enum in this plan carries an explicit `@@map`.
- **Subjects get a foreign key; actors do not.** A `userId` naming the *subject* of a record (the member, the registrant, the certificate holder) declares a real `User` relation, so Postgres enforces referential integrity. A `*ById` field naming the *actor* who performed an action (`invitedById`, `decidedById`, `cancelledById`, `checkedInById`, `revokedById`, `createdById`, `auditLog.actorUserId`) is stored as a plain UUID with no FK — the historical record of who did something must outlive the account that did it. Deletes are `Restrict` except `QrPass` and `RefreshToken`, which are meaningless without their user and so `Cascade`.
- Every task ends with a passing test run and a commit. Conventional commit messages.
- Commit trailer for every commit: `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`

---

## File Structure

| Path | Responsibility |
|---|---|
| `package.json`, `pnpm-workspace.yaml`, `turbo.json` | Workspace root, task pipeline |
| `tsconfig.base.json`, `eslint.config.mjs`, `.prettierrc.json` | Shared toolchain config |
| `packages/config/` | Shared tsconfig/eslint bases consumed by both apps |
| `packages/contracts/src/common/problem.ts` | RFC 9457 Problem Details schema |
| `packages/contracts/src/common/pagination.ts` | Cursor pagination query + page schemas |
| `apps/api/prisma/schema.prisma` | Single Prisma schema, all models |
| `apps/api/prisma/migrations/**` | Hand-augmented SQL for partial indexes, CHECKs, triggers |
| `apps/api/prisma/seed.ts` | Idempotent demo data |
| `apps/api/test/db.ts` | Test database connection + `truncateAll` |
| `apps/api/test/global-setup.ts` | Runs `migrate deploy` once per integration run |
| `apps/api/src/config/env.schema.ts` | Zod-validated environment |
| `apps/api/src/prisma/prisma.service.ts` | PrismaClient + pg adapter, lifecycle |
| `apps/api/src/prisma/transaction.host.ts` | AsyncLocalStorage ambient transaction |
| `apps/api/src/common/problem/problem.filter.ts` | Global exception → `application/problem+json` |
| `apps/api/src/common/problem/domain-error.ts` | Typed domain error base class |
| `apps/api/src/health/health.controller.ts` | `GET /api/v1/health` |
| `.github/workflows/ci.yml` | typecheck → lint → unit → integration → build |

---

## Task 1: Monorepo skeleton and toolchain

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json`, `eslint.config.mjs`, `.prettierrc.json`, `.gitignore`, `.npmrc`, `.nvmrc`
- Create: `packages/config/package.json`, `packages/config/tsconfig.base.json`

**Interfaces:**
- Consumes: nothing (first task)
- Produces: workspace scripts `pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm test`, `pnpm test:integration`, all routed through Turborepo. Package name prefix is `@majlis/`.

- [ ] **Step 1: Create the workspace manifests**

`pnpm-workspace.yaml`:

```yaml
packages:
  - "apps/*"
  - "packages/*"
```

`.npmrc`:

```
engine-strict=true
auto-install-peers=true
```

`.nvmrc`:

```
22.14.0
```

Root `package.json`:

```json
{
  "name": "majlis",
  "private": true,
  "packageManager": "pnpm@11.15.0",
  "engines": { "node": ">=22.14.0", "pnpm": ">=11" },
  "scripts": {
    "build": "turbo run build",
    "lint": "turbo run lint",
    "typecheck": "turbo run typecheck",
    "test": "turbo run test",
    "test:integration": "turbo run test:integration",
    "format": "prettier --write \"**/*.{ts,tsx,json,md,yaml,yml}\""
  },
  "devDependencies": {
    "@eslint/js": "10.0.1",
    "eslint": "10.10.0",
    "eslint-config-prettier": "10.1.8",
    "prettier": "3.9.6",
    "turbo": "2.10.12",
    "typescript": "5.9.3",
    "typescript-eslint": "8.70.0"
  },
  "pnpm": {
    "peerDependencyRules": {
      "allowedVersions": {
        "nestjs-zod>@nestjs/common": "12",
        "nestjs-zod>@nestjs/swagger": "12"
      }
    }
  }
}
```

`nestjs-zod@5.5.0` (added in Task 4) declares peers of `@nestjs/common ^10 || ^11` and `@nestjs/swagger ^7.4.2 || ^8 || ^11`, so NestJS 12 falls outside its stated range. The override records the deliberate judgement that the pipe and DTO surface is unchanged between Nest 11 and 12, rather than leaving an unexplained warning on every install. It is scoped to that one package — it does not relax peer checking generally.

- [ ] **Step 2: Create the Turborepo pipeline**

`turbo.json`:

```json
{
  "$schema": "https://turborepo.com/schema.json",
  "ui": "stream",
  "tasks": {
    "build": { "dependsOn": ["^build"], "outputs": ["dist/**"] },
    "typecheck": { "dependsOn": ["^build"] },
    "lint": {},
    "test": { "dependsOn": ["^build"] },
    "test:integration": { "dependsOn": ["^build"], "cache": false }
  }
}
```

- [ ] **Step 3: Create the shared TypeScript and lint config**

`tsconfig.base.json`:

```json
{
  "$schema": "https://json.schemastore.org/tsconfig",
  "compilerOptions": {
    "target": "ES2023",
    "lib": ["ES2023"],
    "module": "commonjs",
    "moduleResolution": "node",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "exactOptionalPropertyTypes": false,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "sourceMap": true,
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "resolveJsonModule": true
  }
}
```

`eslint.config.mjs`:

```js
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

export default tseslint.config(
  { ignores: ["**/dist/**", "**/node_modules/**", "**/generated/**", "**/.turbo/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/consistent-type-imports": "error",
      "no-console": ["error", { allow: ["warn", "error"] }]
    }
  },
  prettier
);
```

`.prettierrc.json`:

```json
{ "singleQuote": true, "semi": true, "printWidth": 100, "trailingComma": "all" }
```

- [ ] **Step 4: Create `.gitignore`**

```gitignore
node_modules/
dist/
.turbo/
coverage/
*.tsbuildinfo
.env
.env.*
!.env.example
apps/api/src/generated/
.DS_Store
```

- [ ] **Step 5: Create the shared config package**

`packages/config/package.json`:

```json
{
  "name": "@majlis/config",
  "version": "0.0.0",
  "private": true,
  "files": ["tsconfig.base.json"]
}
```

`packages/config/tsconfig.base.json`:

```json
{ "extends": "../../tsconfig.base.json" }
```

- [ ] **Step 6: Install and verify the workspace resolves**

Run:

```bash
pnpm install
pnpm turbo run typecheck --dry=json
```

Expected: install succeeds; the dry run prints a valid task graph with no packages yet (no error).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore: pnpm workspace, turborepo pipeline, shared toolchain

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Contracts package — Problem Details and pagination

**Files:**
- Create: `packages/contracts/package.json`, `packages/contracts/tsconfig.json`, `packages/contracts/vitest.config.ts`
- Create: `packages/contracts/src/index.ts`, `src/common/problem.ts`, `src/common/pagination.ts`
- Test: `packages/contracts/src/common/problem.test.ts`, `src/common/pagination.test.ts`

**Interfaces:**
- Consumes: Task 1's `tsconfig.base.json` and workspace scripts.
- Produces, all exported from `@majlis/contracts`:
  - `problemDetailsSchema: z.ZodObject` and `type ProblemDetails`
  - `problemFieldErrorSchema` and `type ProblemFieldError = { path: string; message: string; code?: string }`
  - `cursorPageQuerySchema` and `type CursorPageQuery = { cursor?: string; limit: number }` (limit defaults to 20, max 100)
  - `cursorPageSchema<T extends z.ZodTypeAny>(item: T)` returning a schema for `{ items: T[]; nextCursor: string | null }`

- [ ] **Step 1: Create the package manifest and config**

`packages/contracts/package.json`:

```json
{
  "name": "@majlis/contracts",
  "version": "0.0.0",
  "private": true,
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "lint": "eslint src",
    "test": "vitest run",
    "test:integration": "echo \"no integration tests in contracts\""
  },
  "dependencies": { "zod": "4.5.4" },
  "devDependencies": { "typescript": "5.9.3", "vitest": "5.0.0" }
}
```

`packages/contracts/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "rootDir": "src", "outDir": "dist" },
  "include": ["src/**/*.ts"],
  "exclude": ["src/**/*.test.ts"]
}
```

`packages/contracts/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['src/**/*.test.ts'], environment: 'node' },
});
```

- [ ] **Step 2: Write the failing tests**

`packages/contracts/src/common/problem.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { problemDetailsSchema } from './problem';

describe('problemDetailsSchema', () => {
  it('defaults type to about:blank when omitted', () => {
    const parsed = problemDetailsSchema.parse({ title: 'Not Found', status: 404 });
    expect(parsed.type).toBe('about:blank');
  });

  it('accepts a full problem with field errors', () => {
    const parsed = problemDetailsSchema.parse({
      type: 'https://majlis.app/problems/validation-failed',
      title: 'Validation failed',
      status: 400,
      detail: 'The request body is invalid.',
      instance: '/api/v1/clubs',
      requestId: '01J000000000000000000000',
      errors: [{ path: 'name', message: 'Required', code: 'invalid_type' }],
    });
    expect(parsed.errors).toHaveLength(1);
    expect(parsed.errors?.[0]?.path).toBe('name');
  });

  it('rejects a status outside the HTTP range', () => {
    expect(() => problemDetailsSchema.parse({ title: 'Nope', status: 99 })).toThrow();
    expect(() => problemDetailsSchema.parse({ title: 'Nope', status: 600 })).toThrow();
  });

  it('requires a title', () => {
    expect(() => problemDetailsSchema.parse({ status: 500 })).toThrow();
  });
});
```

`packages/contracts/src/common/pagination.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { cursorPageQuerySchema, cursorPageSchema } from './pagination';

describe('cursorPageQuerySchema', () => {
  it('defaults limit to 20 when absent', () => {
    expect(cursorPageQuerySchema.parse({}).limit).toBe(20);
  });

  it('coerces a string limit from a query string', () => {
    expect(cursorPageQuerySchema.parse({ limit: '50' }).limit).toBe(50);
  });

  it('rejects a limit above 100, so no endpoint can return an unbounded list', () => {
    expect(() => cursorPageQuerySchema.parse({ limit: 101 })).toThrow();
  });

  it('rejects a limit below 1', () => {
    expect(() => cursorPageQuerySchema.parse({ limit: 0 })).toThrow();
  });
});

describe('cursorPageSchema', () => {
  it('wraps an item schema and allows a null nextCursor on the last page', () => {
    const schema = cursorPageSchema(z.object({ id: z.string() }));
    const parsed = schema.parse({ items: [{ id: 'a' }], nextCursor: null });
    expect(parsed.items).toHaveLength(1);
    expect(parsed.nextCursor).toBeNull();
  });

  it('rejects items that do not match the item schema', () => {
    const schema = cursorPageSchema(z.object({ id: z.string() }));
    expect(() => schema.parse({ items: [{ id: 1 }], nextCursor: null })).toThrow();
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm --filter @majlis/contracts test`
Expected: FAIL — `Cannot find module './problem'` and `'./pagination'`.

- [ ] **Step 4: Implement the schemas**

`packages/contracts/src/common/problem.ts`:

```ts
import { z } from 'zod';

/** A single field-level validation failure inside a Problem Details response. */
export const problemFieldErrorSchema = z.object({
  path: z.string(),
  message: z.string(),
  code: z.string().optional(),
});

/** RFC 9457 Problem Details, plus the two extension members Majlis always sends. */
export const problemDetailsSchema = z.object({
  type: z.string().default('about:blank'),
  title: z.string(),
  status: z.number().int().min(100).max(599),
  detail: z.string().optional(),
  instance: z.string().optional(),
  requestId: z.string().optional(),
  errors: z.array(problemFieldErrorSchema).optional(),
});

export type ProblemFieldError = z.infer<typeof problemFieldErrorSchema>;
export type ProblemDetails = z.infer<typeof problemDetailsSchema>;
```

`packages/contracts/src/common/pagination.ts`:

```ts
import { z } from 'zod';

export const MAX_PAGE_LIMIT = 100;
export const DEFAULT_PAGE_LIMIT = 20;

/**
 * Query parameters for every list endpoint. The upper bound on `limit` is the
 * mechanism that makes an unbounded list impossible to request.
 */
export const cursorPageQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_LIMIT).default(DEFAULT_PAGE_LIMIT),
});

export type CursorPageQuery = z.infer<typeof cursorPageQuerySchema>;

/** Wraps an item schema into a cursor-paginated page. */
export function cursorPageSchema<T extends z.ZodTypeAny>(item: T) {
  return z.object({
    items: z.array(item),
    nextCursor: z.string().nullable(),
  });
}
```

`packages/contracts/src/index.ts`:

```ts
export * from './common/problem';
export * from './common/pagination';
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @majlis/contracts test`
Expected: PASS — 10 tests.

- [ ] **Step 6: Verify it builds and typechecks**

Run: `pnpm --filter @majlis/contracts build && pnpm --filter @majlis/contracts typecheck && pnpm --filter @majlis/contracts lint`
Expected: all three exit 0.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(contracts): Problem Details and cursor pagination schemas

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Postgres 18 install and database bootstrap

**Files:**
- Create: `.env.example`, `.env` (gitignored)
- Create: `scripts/bootstrap-db.sql`
- Modify: root `package.json` — add a `db:check` script

> Naming, because it has bitten once: `majlis` is a **role**, not a database. Exactly **two** databases exist — `majlis_dev` and `majlis_test`. Do not create a database called `majlis`.

**Interfaces:**
- Consumes: Task 1's root manifest.
- Produces: a running Postgres 18 on `localhost:5432`, role `majlis`, databases `majlis_dev` and `majlis_test`, and these environment variables, which every later task depends on by these exact names: `DATABASE_URL`, `DIRECT_URL`, `TEST_DATABASE_URL`, `NODE_ENV`, `PORT`, `LOG_LEVEL`.

> This task installs software on the developer's machine. It is a prerequisite, not application code, so it has a verification step rather than a unit test.

- [ ] **Step 1: Install PostgreSQL 18**

`winget` is present on this machine but not on the shell's PATH. Run from PowerShell:

```powershell
& "$env:LOCALAPPDATA\Microsoft\WindowsApps\winget.exe" install --id PostgreSQL.PostgreSQL.18 --exact --accept-package-agreements --accept-source-agreements
```

The installer prompts for a superuser password. Use `postgres` for local development and note it — it is needed in the next step. Chocolatey (`choco install postgresql18`) is the fallback if winget fails.

- [ ] **Step 2: Verify the server is running and on PATH**

Run in a **new** PowerShell window (PATH changes need a fresh shell):

```powershell
$env:Path += ";C:\Program Files\PostgreSQL\18\bin"
psql --version
Get-Service postgresql-x64-18 | Select-Object Name, Status
```

Expected: `psql (PostgreSQL) 18.x` and status `Running`.

- [ ] **Step 3: Create the role and databases**

`scripts/bootstrap-db.sql`:

```sql
-- Local development bootstrap. Safe to re-run.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'majlis') THEN
    CREATE ROLE majlis WITH LOGIN PASSWORD 'majlis' CREATEDB;
  END IF;
END
$$;
```

Run:

```powershell
$env:Path += ";C:\Program Files\PostgreSQL\18\bin"
$env:PGPASSWORD = "postgres"
psql -U postgres -h localhost -f scripts/bootstrap-db.sql
psql -U postgres -h localhost -c "CREATE DATABASE majlis_dev OWNER majlis;"
psql -U postgres -h localhost -c "CREATE DATABASE majlis_test OWNER majlis;"
```

If a database already exists, `psql` reports an error and continues — that is fine and expected on a re-run.

- [ ] **Step 4: Create the environment files**

`.env.example` (committed):

```dotenv
NODE_ENV=development
PORT=3001
LOG_LEVEL=debug

# Pooled connection used by the application at runtime.
# In production this is Supabase's transaction pooler on :6543 with
# ?pgbouncer=true&connection_limit=1
DATABASE_URL="postgresql://majlis:majlis@localhost:5432/majlis_dev?schema=public"

# Direct connection used by prisma migrate. In production, Supabase :5432.
DIRECT_URL="postgresql://majlis:majlis@localhost:5432/majlis_dev?schema=public"

# Dedicated database for integration tests. Truncated between tests.
TEST_DATABASE_URL="postgresql://majlis:majlis@localhost:5432/majlis_test?schema=public"
```

Then `cp .env.example .env`. `.env` is gitignored.

- [ ] **Step 5: Add and run the connectivity check**

Add to root `package.json` scripts:

```json
"db:check": "node --env-file=.env -e \"const{Client}=require('pg');const c=new Client({connectionString:process.env.DATABASE_URL});c.connect().then(()=>c.query('select version()')).then(r=>{console.error(r.rows[0].version);return c.end()}).catch(e=>{console.error(e.message);process.exit(1)})\""
```

Install `pg` at the root as a dev dependency for this check:

```bash
pnpm add -w -D pg@8.16.3 @types/pg@8.15.6
```

Run: `pnpm db:check`
Expected: prints `PostgreSQL 18.x ...` and exits 0.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: local Postgres 18 bootstrap and environment template

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Prisma wiring and the integration test harness

**Files:**
- Create: `apps/api/package.json`, `apps/api/tsconfig.json`, `apps/api/tsconfig.build.json`, `apps/api/vitest.config.ts`, `apps/api/vitest.integration.config.ts`
- Create: `apps/api/prisma/schema.prisma`, `apps/api/prisma.config.ts`
- Create: `apps/api/test/db.ts`, `apps/api/test/global-setup.ts`
- Test: `apps/api/test/harness.integration.test.ts`

**Interfaces:**
- Consumes: `TEST_DATABASE_URL` from Task 3.
- Produces:
  - `apps/api/src/generated/prisma/client` exporting `PrismaClient` (CJS, gitignored)
  - `test/db.ts` exporting `createTestPrisma(): PrismaClient`, `truncateAll(prisma: PrismaClient): Promise<void>`, and `disconnectTestPrisma(prisma: PrismaClient): Promise<void>`
  - script names `test` (unit, `*.spec.ts`) and `test:integration` (`*.integration.test.ts`)

- [ ] **Step 1: Create the API package manifest**

`apps/api/package.json`:

```json
{
  "name": "@majlis/api",
  "version": "0.0.0",
  "private": true,
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "start:dev": "node --watch -r @swc-node/register src/main.ts",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "lint": "eslint src test prisma",
    "test": "vitest run --config vitest.config.ts",
    "test:integration": "dotenv -e ../../.env -c -- vitest run --config vitest.integration.config.ts",
    "prisma:generate": "prisma generate",
    "prisma:migrate": "prisma migrate dev",
    "prisma:deploy": "prisma migrate deploy",
    "db:seed": "dotenv -e ../../.env -c -- tsx prisma/seed.ts"
  },
  "dependencies": {
    "@nestjs/common": "12.0.1",
    "@nestjs/config": "12.0.0",
    "@nestjs/core": "12.0.1",
    "@nestjs/platform-express": "12.0.1",
    "@nestjs/swagger": "12.0.1",
    "@prisma/adapter-pg": "7.10.0",
    "@prisma/client": "7.10.0",
    "@majlis/contracts": "workspace:*",
    "nestjs-pino": "5.1.0",
    "nestjs-zod": "5.5.0",
    "pg": "8.16.3",
    "pino": "10.3.1",
    "pino-http": "11.0.0",
    "reflect-metadata": "0.2.2",
    "rxjs": "7.8.2",
    "uuid": "13.0.0",
    "zod": "4.5.4"
  },
  "devDependencies": {
    "@nestjs/testing": "12.0.1",
    "@swc/core": "1.16.2",
    "@swc-node/register": "1.12.1",
    "@types/express": "5.0.3",
    "@types/node": "22.14.0",
    "@types/pg": "8.15.6",
    "@types/supertest": "6.0.3",
    "dotenv": "17.2.3",
    "dotenv-cli": "10.0.0",
    "pino-pretty": "13.1.2",
    "prisma": "7.10.0",
    "supertest": "7.1.4",
    "tsx": "4.20.6",
    "typescript": "5.9.3",
    "unplugin-swc": "1.5.7",
    "vite": "8.2.2",
    "vitest": "5.0.0"
  }
}
```

- [ ] **Step 2: Create the TypeScript and Vitest configs**

`apps/api/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": ".",
    "outDir": "./dist",
    "baseUrl": ".",
    "types": ["node"]
  },
  "include": ["src/**/*.ts", "test/**/*.ts", "prisma/**/*.ts"],
  "exclude": ["dist", "node_modules"]
}
```

**There is deliberately no `@nestjs/cli` and no `nest-cli.json`.** `@nestjs/cli@12.0.0` is the only stable 12.x release and it is broken: it pins `ora@9.4.1`, which is ESM-only, and `@angular-devkit/schematics@22.1.5` `require()`s it in a cycle, so *any* invocation — even `nest --version` — dies with `ERR_REQUIRE_CYCLE_MODULE` on Node 22. Verified directly, not assumed. `@nestjs/cli@11.0.24` works (it uses the CJS `ora@5.4.1`) but mixes majors and drags in a large Angular-derived dependency tree this project never otherwise uses.

So the build is plain `tsc`. Nothing here needs schematics or asset copying, and `tsc` is faster.

**The dev loop cannot be `tsx`, though.** `tsx` transforms via esbuild, and esbuild does not implement `emitDecoratorMetadata` at all — so NestJS constructor injection silently breaks, with `ConfigService` arriving as `undefined` in `PrismaService`. Verified, not theorised. The dev runner is therefore `node --watch -r @swc-node/register`: SWC does implement decorator metadata, it reads `emitDecoratorMetadata` straight from `tsconfig.json`, and `@swc/core` is already a pinned dependency because Vitest uses it for the same reason.

`apps/api/tsconfig.build.json`:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": { "rootDir": "src" },
  "exclude": ["dist", "node_modules", "test", "src/**/*.spec.ts", "prisma/seed.ts"]
}
```

`rootDir` is narrowed to `src` here deliberately. The base `tsconfig.json` uses `"."` so that tests and the seed are type-checked, but leaving it at `"."` for the build puts the entry point at `dist/src/main.js` instead of `dist/main.js`.

Vitest must compile decorators, so both configs use the SWC plugin.

`apps/api/vitest.config.ts` (unit):

```ts
import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    include: ['src/**/*.spec.ts'],
    environment: 'node',
    globals: false,
  },
});
```

`apps/api/vitest.integration.config.ts`:

```ts
import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    include: ['{src,test}/**/*.integration.test.ts'],
    environment: 'node',
    globals: false,
    globalSetup: ['./test/global-setup.ts'],
    // The test database is shared state; serializing file execution keeps
    // truncation honest. Vitest 5 removed `poolOptions.forks.singleFork` —
    // this top-level flag replaces it and forces maxWorkers to 1.
    pool: 'forks',
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
```

- [ ] **Step 3: Create the Prisma schema with no models yet**

`apps/api/prisma/schema.prisma`:

```prisma
// Majlis schema. Database objects are snake_case; the client is camelCase.
//
// Prisma 7 notes:
//  - the `prisma-client` generator replaces `prisma-client-js`
//  - `output` is required; the client is NOT written into node_modules
//  - default output is ESM, so `moduleFormat = "cjs"` keeps NestJS on CommonJS
//  - a driver adapter (@prisma/adapter-pg) is mandatory at runtime

generator client {
  provider     = "prisma-client"
  output       = "../src/generated/prisma"
  runtime      = "nodejs"
  moduleFormat = "cjs"
}

datasource db {
  provider = "postgresql"
}
```

**The datasource block carries no `url`.** Prisma 7 removed it — a `url` here is now a hard validation error (`P1012`), not a deprecation. Connection strings live in `prisma.config.ts`, created in the next step. This was verified against `prisma@7.10.0` directly, not assumed.

- [ ] **Step 3b: Create the Prisma config**

`apps/api/prisma.config.ts`:

```ts
import { config } from 'dotenv';
import { defineConfig, env } from 'prisma/config';

// The workspace keeps one .env at the repo root, two levels up from here.
config({ path: '../../.env' });

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  // Migrations use the DIRECT connection. The application uses the pooled
  // one via the driver adapter in PrismaService — on Supabase those differ
  // (:5432 direct, :6543 transaction pooler), and migrations cannot run
  // through pgBouncer.
  datasource: { url: env('DIRECT_URL') },
});
```

Add `dotenv` to `apps/api` devDependencies: `"dotenv": "17.2.3"`.

Because this file loads the root `.env` itself, the Prisma CLI no longer needs a `dotenv-cli` wrapper — `pnpm prisma migrate dev` works directly. `dotenv` does not override variables already present in the environment, so the test harness can still point migrations at `majlis_test` by setting `DIRECT_URL` in the child process.

- [ ] **Step 4: Write the failing harness test**

`apps/api/test/harness.integration.test.ts`:

```ts
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestPrisma, disconnectTestPrisma, truncateAll } from './db';

const prisma = createTestPrisma();

afterAll(async () => {
  await disconnectTestPrisma(prisma);
});

beforeEach(async () => {
  await truncateAll(prisma);
});

describe('integration test harness', () => {
  it('connects to the test database and it is Postgres 18 or newer', async () => {
    const rows = await prisma.$queryRaw<{ v: number }[]>`SELECT current_setting('server_version_num')::int AS v`;
    expect(rows[0]!.v).toBeGreaterThanOrEqual(180000);
  });

  it('is pointed at majlis_test, never at the development database', async () => {
    const rows = await prisma.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`;
    expect(rows[0]!.db).toBe('majlis_test');
  });

  it('refuses a connection string that does not name the test database', async () => {
    const saved = process.env.TEST_DATABASE_URL;
    process.env.TEST_DATABASE_URL = 'postgresql://majlis:majlis@localhost:5432/majlis_dev';
    expect(() => createTestPrisma()).toThrow(/non-test database/);
    process.env.TEST_DATABASE_URL = saved;
  });

  it('truncateAll runs without error when there are no application tables yet', async () => {
    await expect(truncateAll(prisma)).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 5: Run the test to verify it fails**

Run: `pnpm --filter @majlis/api test:integration`
Expected: FAIL — cannot resolve `./db` and `./global-setup`.

- [ ] **Step 6: Implement the harness**

`apps/api/test/db.ts`:

```ts
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';

/** Resolves the test connection string, refusing to run against anything else. */
export function testDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('TEST_DATABASE_URL is not set. Copy .env.example to .env.');
  if (!url.includes('majlis_test')) {
    throw new Error(`Refusing to run integration tests against a non-test database: ${url}`);
  }
  return url;
}

export function createTestPrisma(): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: testDatabaseUrl() }) });
}

export async function disconnectTestPrisma(prisma: PrismaClient): Promise<void> {
  await prisma.$disconnect();
}

/**
 * Empties every application table between tests. `_prisma_migrations` is
 * preserved so migrations are applied once per run rather than once per test.
 */
export async function truncateAll(prisma: PrismaClient): Promise<void> {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;

  if (tables.length === 0) return;

  const list = tables.map((t) => `"public"."${t.tablename}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}
```

`apps/api/test/global-setup.ts`:

```ts
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { testDatabaseUrl } from './db';

/**
 * Applies all migrations to the test database once, before any test file runs.
 *
 * `prisma migrate deploy` errors on an empty migrations directory, which is
 * the state until the first schema task lands — so this is a no-op until
 * there is something to apply.
 */
export default function setup(): void {
  const url = testDatabaseUrl();
  const dir = join(__dirname, '..', 'prisma', 'migrations');

  const hasMigrations =
    existsSync(dir) && readdirSync(dir, { withFileTypes: true }).some((e) => e.isDirectory());

  if (!hasMigrations) return;

  execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, DATABASE_URL: url, DIRECT_URL: url },
  });
}
```

- [ ] **Step 7: Install and generate the client**

Vitest does not read `.env` on its own, which is why the `test:integration` script above is wrapped in `dotenv-cli`. The `-c` flag makes a missing `.env` non-fatal, so CI can supply the same variables through its own `env:` block instead.

**Do not create a migration in this task.** There are no models yet, and Prisma will not produce an empty migration — which is exactly why `global-setup.ts` above skips `migrate deploy` while the migrations directory is empty. The first real migration arrives in Task 5.

```bash
pnpm install
cd apps/api
pnpm prisma generate
```

Expected: `src/generated/prisma/` is populated with a CommonJS client, and `prisma/migrations/` does not exist yet.

- [ ] **Step 8: Run the test to verify it passes**

Run: `pnpm --filter @majlis/api test:integration`
Expected: PASS — 4 tests. The global setup prints migration output first.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat(api): Prisma 7 wiring and real-Postgres integration harness

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Schema — identity (User, RefreshToken)

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/<ts>_identity/migration.sql`
- Test: `apps/api/test/schema/identity.integration.test.ts`

> **`user` is a reserved word in Postgres.** `@@map("user")` produces a table literally named `user`, so every raw-SQL reference to it must be double-quoted — `ALTER TABLE "user"`, `TRUNCATE "public"."user"`. Unquoted `FROM user` resolves to the `user` keyword (an alias for `current_user`) and fails confusingly rather than obviously. Prisma quotes automatically, so this only affects hand-written migration SQL. The table stays singular for consistency with `club`, `event`, and the rest of the schema.

**Interfaces:**
- Consumes: Task 4's harness (`createTestPrisma`, `truncateAll`, `disconnectTestPrisma`).
- Produces: Prisma models `User` and `RefreshToken`, and enums `UserStatus { ACTIVE SUSPENDED }`, `PlatformRole { STUDENT ADMIN }`. Later tasks reference `User.id` as the actor foreign key.

- [ ] **Step 1: Write the failing test**

`apps/api/test/schema/identity.integration.test.ts`:

```ts
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestPrisma, disconnectTestPrisma, truncateAll } from '../db';

const prisma = createTestPrisma();

afterAll(async () => { await disconnectTestPrisma(prisma); });
beforeEach(async () => { await truncateAll(prisma); });

function newUser(over: Partial<{ email: string; fullName: string }> = {}) {
  return {
    email: over.email ?? `student.${Math.random().toString(36).slice(2)}@uni.ac.ae`,
    passwordHash: 'argon2id$placeholder',
    fullName: over.fullName ?? 'Test Student',
  };
}

describe('User', () => {
  it('assigns a UUID v7 id, which is time-sortable', async () => {
    const first = await prisma.user.create({ data: newUser() });
    await new Promise((r) => setTimeout(r, 5));
    const second = await prisma.user.create({ data: newUser() });

    // Version nibble of a UUID v7 sits at index 14.
    expect(first.id[14]).toBe('7');
    expect(first.id < second.id).toBe(true);
  });

  it('defaults to an ACTIVE student', async () => {
    const user = await prisma.user.create({ data: newUser() });
    expect(user.status).toBe('ACTIVE');
    expect(user.platformRole).toBe('STUDENT');
  });

  it('rejects a duplicate email', async () => {
    await prisma.user.create({ data: newUser({ email: 'dupe@uni.ac.ae' }) });
    await expect(prisma.user.create({ data: newUser({ email: 'dupe@uni.ac.ae' }) }))
      .rejects.toMatchObject({ code: 'P2002' });
  });

  it('rejects an email that is not already lowercased', async () => {
    await expect(prisma.user.create({ data: newUser({ email: 'Mixed@Uni.ac.ae' }) }))
      .rejects.toThrow(/user_email_lowercase/);
  });

  it('stores createdAt as timestamptz', async () => {
    const rows = await prisma.$queryRaw<{ data_type: string }[]>`
      SELECT data_type FROM information_schema.columns
      WHERE table_name = 'user' AND column_name = 'created_at'`;
    expect(rows[0]!.data_type).toBe('timestamp with time zone');
  });
});

describe('RefreshToken', () => {
  it('cascades away when its user is deleted', async () => {
    const user = await prisma.user.create({ data: newUser() });
    await prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: 'hash-1',
        familyId: '00000000-0000-7000-8000-000000000001',
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });

    await prisma.user.delete({ where: { id: user.id } });
    expect(await prisma.refreshToken.count()).toBe(0);
  });

  it('rejects a duplicate token hash', async () => {
    const user = await prisma.user.create({ data: newUser() });
    const base = {
      userId: user.id,
      familyId: '00000000-0000-7000-8000-000000000002',
      expiresAt: new Date(Date.now() + 86_400_000),
    };
    await prisma.refreshToken.create({ data: { ...base, tokenHash: 'same' } });
    await expect(prisma.refreshToken.create({ data: { ...base, tokenHash: 'same' } }))
      .rejects.toMatchObject({ code: 'P2002' });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @majlis/api test:integration test/schema/identity.integration.test.ts`
Expected: FAIL — `prisma.user` is undefined.

- [ ] **Step 3: Add the models to the schema**

Append to `apps/api/prisma/schema.prisma`:

```prisma
enum UserStatus {
  ACTIVE
  SUSPENDED

  @@map("user_status")
}

enum PlatformRole {
  STUDENT
  ADMIN

  @@map("platform_role")
}

/// A person. There is no separate university identifier — the verified email
/// is the identity key, and Operations verifies a scanned pass against name + email.
model User {
  id           String       @id @default(uuid(7)) @db.Uuid
  email        String       @unique
  passwordHash String       @map("password_hash")
  fullName     String       @map("full_name")
  avatarUrl    String?      @map("avatar_url")
  status       UserStatus   @default(ACTIVE)
  platformRole PlatformRole @default(STUDENT) @map("platform_role")
  createdAt    DateTime     @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt    DateTime     @updatedAt @map("updated_at") @db.Timestamptz(3)

  refreshTokens RefreshToken[]

  @@map("user")
}

/// One row per issued refresh token. Rotation replaces a row and links it via
/// replacedById; presenting an already-rotated token revokes the whole family.
model RefreshToken {
  id          String    @id @default(uuid(7)) @db.Uuid
  userId      String    @map("user_id") @db.Uuid
  tokenHash   String    @unique @map("token_hash")
  familyId    String    @map("family_id") @db.Uuid
  expiresAt   DateTime  @map("expires_at") @db.Timestamptz(3)
  revokedAt   DateTime? @map("revoked_at") @db.Timestamptz(3)
  replacedById String?  @map("replaced_by_id") @db.Uuid
  userAgent   String?   @map("user_agent")
  ip          String?
  createdAt   DateTime  @default(now()) @map("created_at") @db.Timestamptz(3)

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@index([familyId])
  @@map("refresh_token")
}
```

- [ ] **Step 4: Generate the migration and add the lowercase-email constraint**

```bash
cd apps/api
pnpm prisma migrate dev --name identity --create-only
```

Append to the generated `migration.sql`:

```sql
-- Email is the identity key, so it is stored canonically lowercased.
-- Enforcing it here means no code path can create a case-variant duplicate.
ALTER TABLE "user"
  ADD CONSTRAINT "user_email_lowercase" CHECK ("email" = lower("email"));
```

Apply it and regenerate the client:

```bash
pnpm prisma migrate dev
pnpm prisma generate
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @majlis/api test:integration test/schema/identity.integration.test.ts`
Expected: PASS — 7 tests.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(api): User and RefreshToken models with lowercase-email constraint

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Schema — organisation (Department, Club, ClubTeamAppointment, ClubMembership)

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/<ts>_organisation/migration.sql`
- Test: `apps/api/test/schema/organisation.integration.test.ts`

**Interfaces:**
- Consumes: `User` from Task 5.
- Produces: models `Department`, `Club`, `ClubTeamAppointment`, `ClubMembership`; enums `MembershipPolicy { OPEN APPROVAL_REQUIRED INVITE_ONLY CLOSED }`, `ClubStatus { ACTIVE SUSPENDED ARCHIVED }`, `ClubRole { LEAD VICE_LEAD MARKETING CTO OPERATIONS }`, `AppointmentStatus { INVITED ACTIVE DECLINED EXPIRED ENDED }`, `MembershipStatus { PENDING ACTIVE REJECTED LEFT REMOVED }`.
- Two partial unique indexes this task must create, named exactly: `club_team_appointment_one_active_lead`, `club_membership_one_open_per_user`.

- [ ] **Step 1: Write the failing test**

`apps/api/test/schema/organisation.integration.test.ts`:

```ts
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestPrisma, disconnectTestPrisma, truncateAll } from '../db';

const prisma = createTestPrisma();

afterAll(async () => { await disconnectTestPrisma(prisma); });
beforeEach(async () => { await truncateAll(prisma); });

let seq = 0;
const uniq = () => `${Date.now()}-${seq++}-${Math.random().toString(36).slice(2)}`;

async function aUser() {
  return prisma.user.create({
    data: { email: `u.${uniq()}@uni.ac.ae`, passwordHash: 'x', fullName: 'User' },
  });
}

async function aClub() {
  const department = await prisma.department.create({
    data: { name: `Dept ${uniq()}`, code: `D${uniq()}` },
  });
  return prisma.club.create({
    data: {
      departmentId: department.id,
      name: `Club ${uniq()}`,
      slug: `club-${uniq()}`,
      description: 'A club.',
      category: 'Technology',
      academicYear: '2026/2027',
      logoUrl: 'https://example.test/logo.png',
    },
  });
}

describe('Club', () => {
  it('is ACTIVE on creation — there is no approval gate', async () => {
    const club = await aClub();
    expect(club.status).toBe('ACTIVE');
  });

  it('defaults membership policy to OPEN', async () => {
    expect((await aClub()).membershipPolicy).toBe('OPEN');
  });

  it('rejects a duplicate slug', async () => {
    const club = await aClub();
    const department = await prisma.department.create({
      data: { name: `Dept ${uniq()}`, code: `D${uniq()}` },
    });
    await expect(
      prisma.club.create({
        data: {
          departmentId: department.id,
          name: `Club ${uniq()}`,
          slug: club.slug,
          description: 'x',
          category: 'x',
          academicYear: '2026/2027',
          logoUrl: 'https://example.test/logo.png',
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });
});

describe('ClubTeamAppointment — exactly one active Lead per club', () => {
  async function appoint(clubId: string, userId: string, role: 'LEAD' | 'OPERATIONS', status: 'ACTIVE' | 'ENDED' | 'INVITED') {
    return prisma.clubTeamAppointment.create({
      data: { clubId, userId, role, status, invitedById: userId },
    });
  }

  it('rejects a second ACTIVE Lead in the same club', async () => {
    const club = await aClub();
    const [a, b] = [await aUser(), await aUser()];
    await appoint(club.id, a.id, 'LEAD', 'ACTIVE');
    await expect(appoint(club.id, b.id, 'LEAD', 'ACTIVE')).rejects.toMatchObject({ code: 'P2002' });
  });

  it('allows a new ACTIVE Lead once the previous appointment has ENDED', async () => {
    const club = await aClub();
    const [a, b] = [await aUser(), await aUser()];
    const first = await appoint(club.id, a.id, 'LEAD', 'ACTIVE');
    await prisma.clubTeamAppointment.update({
      where: { id: first.id },
      data: { status: 'ENDED', endedAt: new Date() },
    });
    await expect(appoint(club.id, b.id, 'LEAD', 'ACTIVE')).resolves.toBeDefined();
  });

  it('allows an INVITED Lead alongside an ACTIVE one, since an invitation grants nothing', async () => {
    const club = await aClub();
    const [a, b] = [await aUser(), await aUser()];
    await appoint(club.id, a.id, 'LEAD', 'ACTIVE');
    await expect(appoint(club.id, b.id, 'LEAD', 'INVITED')).resolves.toBeDefined();
  });

  it('allows several active Operations officers in one club', async () => {
    const club = await aClub();
    const [a, b] = [await aUser(), await aUser()];
    await appoint(club.id, a.id, 'OPERATIONS', 'ACTIVE');
    await expect(appoint(club.id, b.id, 'OPERATIONS', 'ACTIVE')).resolves.toBeDefined();
  });

  it('allows the same person to lead two different clubs', async () => {
    const [c1, c2] = [await aClub(), await aClub()];
    const user = await aUser();
    await appoint(c1.id, user.id, 'LEAD', 'ACTIVE');
    await expect(appoint(c2.id, user.id, 'LEAD', 'ACTIVE')).resolves.toBeDefined();
  });
});

describe('ClubMembership — one open membership per (user, club)', () => {
  async function join(clubId: string, userId: string, status: 'PENDING' | 'ACTIVE' | 'LEFT' | 'REMOVED') {
    return prisma.clubMembership.create({ data: { clubId, userId, status } });
  }

  it('rejects a duplicate ACTIVE membership', async () => {
    const club = await aClub();
    const user = await aUser();
    await join(club.id, user.id, 'ACTIVE');
    await expect(join(club.id, user.id, 'ACTIVE')).rejects.toMatchObject({ code: 'P2002' });
  });

  it('rejects a PENDING request when an ACTIVE membership already exists', async () => {
    const club = await aClub();
    const user = await aUser();
    await join(club.id, user.id, 'ACTIVE');
    await expect(join(club.id, user.id, 'PENDING')).rejects.toMatchObject({ code: 'P2002' });
  });

  it('rejects a duplicate PENDING request', async () => {
    const club = await aClub();
    const user = await aUser();
    await join(club.id, user.id, 'PENDING');
    await expect(join(club.id, user.id, 'PENDING')).rejects.toMatchObject({ code: 'P2002' });
  });

  it('scopes the rule per user — two students may both hold open memberships in one club', async () => {
    // Without this, a (club_id)-only index would pass every other test in
    // this block while capping each club at one member platform-wide.
    const club = await aClub();
    const [a, b] = [await aUser(), await aUser()];
    await join(club.id, a.id, 'ACTIVE');
    await expect(join(club.id, b.id, 'ACTIVE')).resolves.toBeDefined();
  });

  it('allows re-joining after LEFT, and keeps the historic row', async () => {
    const club = await aClub();
    const user = await aUser();
    await join(club.id, user.id, 'LEFT');
    await expect(join(club.id, user.id, 'ACTIVE')).resolves.toBeDefined();
    expect(await prisma.clubMembership.count()).toBe(2);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @majlis/api test:integration test/schema/organisation.integration.test.ts`
Expected: FAIL — `prisma.department` is undefined.

- [ ] **Step 3: Add the models to the schema**

Append to `apps/api/prisma/schema.prisma`:

```prisma
enum ClubStatus {
  ACTIVE
  SUSPENDED
  ARCHIVED

  @@map("club_status")
}

enum MembershipPolicy {
  OPEN
  APPROVAL_REQUIRED
  INVITE_ONLY
  CLOSED

  @@map("membership_policy")
}

enum ClubRole {
  LEAD
  VICE_LEAD
  MARKETING
  CTO
  OPERATIONS

  @@map("club_role")
}

enum AppointmentStatus {
  INVITED
  ACTIVE
  DECLINED
  EXPIRED
  ENDED

  @@map("appointment_status")
}

enum MembershipStatus {
  PENDING
  ACTIVE
  REJECTED
  LEFT
  REMOVED

  @@map("membership_status")
}

model Department {
  id          String   @id @default(uuid(7)) @db.Uuid
  name        String   @unique
  code        String   @unique
  description String?
  createdAt   DateTime @default(now()) @map("created_at") @db.Timestamptz(3)

  clubs Club[]

  @@map("department")
}

/// A club is ACTIVE the moment an Admin creates it. There is deliberately no
/// review or approval state anywhere in the product.
model Club {
  id               String           @id @default(uuid(7)) @db.Uuid
  departmentId     String           @map("department_id") @db.Uuid
  name             String           @unique
  slug             String           @unique
  description      String
  category         String
  academicYear     String           @map("academic_year")
  logoUrl          String           @map("logo_url")
  bannerUrl        String?          @map("banner_url")
  membershipPolicy MembershipPolicy @default(OPEN) @map("membership_policy")
  status           ClubStatus       @default(ACTIVE)
  createdAt        DateTime         @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt        DateTime         @updatedAt @map("updated_at") @db.Timestamptz(3)

  department   Department            @relation(fields: [departmentId], references: [id], onDelete: Restrict)
  appointments ClubTeamAppointment[]
  memberships  ClubMembership[]

  @@index([departmentId])
  @@index([status])
  @@map("club")
}

/// Club-scoped authority. No permission is active until status = ACTIVE.
/// Appointments end; they are never deleted, so history survives.
model ClubTeamAppointment {
  id                    String            @id @default(uuid(7)) @db.Uuid
  clubId                String            @map("club_id") @db.Uuid
  userId                String            @map("user_id") @db.Uuid
  role                  ClubRole
  status                AppointmentStatus @default(INVITED)
  invitedById           String            @map("invited_by_id") @db.Uuid
  invitationTokenHash   String?           @unique @map("invitation_token_hash")
  invitationExpiresAt   DateTime?         @map("invitation_expires_at") @db.Timestamptz(3)
  termStart             DateTime?         @map("term_start") @db.Timestamptz(3)
  termEnd               DateTime?         @map("term_end") @db.Timestamptz(3)
  acceptedAt            DateTime?         @map("accepted_at") @db.Timestamptz(3)
  endedAt               DateTime?         @map("ended_at") @db.Timestamptz(3)
  endedReason           String?           @map("ended_reason")
  createdAt             DateTime          @default(now()) @map("created_at") @db.Timestamptz(3)

  club Club @relation(fields: [clubId], references: [id], onDelete: Cascade)
  user User @relation(fields: [userId], references: [id], onDelete: Restrict)

  @@index([clubId, status])
  @@index([userId, status])
  @@map("club_team_appointment")
}

/// Ordinary membership. Separate from appointment: being a member grants
/// no management permission of any kind.
model ClubMembership {
  id             String           @id @default(uuid(7)) @db.Uuid
  clubId         String           @map("club_id") @db.Uuid
  userId         String           @map("user_id") @db.Uuid
  status         MembershipStatus @default(PENDING)
  requestedAt    DateTime         @default(now()) @map("requested_at") @db.Timestamptz(3)
  decidedAt      DateTime?        @map("decided_at") @db.Timestamptz(3)
  decidedById    String?          @map("decided_by_id") @db.Uuid
  decisionReason String?          @map("decision_reason")

  club Club @relation(fields: [clubId], references: [id], onDelete: Cascade)
  user User @relation(fields: [userId], references: [id], onDelete: Restrict)

  @@index([clubId, status])
  @@index([userId, status])
  @@map("club_membership")
}
```

Add the matching back-relations to `User` (modify the existing model):

```prisma
  memberships  ClubMembership[]
  appointments ClubTeamAppointment[]
```

- [ ] **Step 4: Generate the migration and add the partial unique indexes**

```bash
cd apps/api
pnpm prisma migrate dev --name organisation --create-only
```

Append to the generated `migration.sql`:

```sql
-- Lead is singular per club. Prisma cannot express a partial unique index,
-- so it is written by hand. INVITED and ENDED rows are excluded on purpose:
-- an invitation grants nothing, and history must be allowed to accumulate.
CREATE UNIQUE INDEX "club_team_appointment_one_active_lead"
  ON "club_team_appointment" ("club_id")
  WHERE "role" = 'LEAD' AND "status" = 'ACTIVE';

-- One open membership per (user, club). PENDING is included so a student
-- cannot queue two requests, and so a request cannot be filed against a
-- membership they already hold.
CREATE UNIQUE INDEX "club_membership_one_open_per_user"
  ON "club_membership" ("club_id", "user_id")
  WHERE "status" IN ('PENDING', 'ACTIVE');
```

Apply and regenerate:

```bash
pnpm prisma migrate dev
pnpm prisma generate
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @majlis/api test:integration test/schema/organisation.integration.test.ts`
Expected: PASS — 13 tests.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(api): department, club, appointment and membership models

Adds the two partial unique indexes that make 'one Lead per club' and
'one open membership per (user, club)' database facts rather than
application conventions.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Schema — events (Event, EventAssignment, EventRegistration)

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/<ts>_events/migration.sql`
- Test: `apps/api/test/schema/events.integration.test.ts`

**Interfaces:**
- Consumes: `Club` and `User` from Tasks 5–6.
- Produces: models `Event`, `EventAssignment`, `EventRegistration`; enums `EventStatus { DRAFT PUBLISHED REGISTRATION_CLOSED ONGOING COMPLETED CERTIFIED CANCELLED }`, `AttendancePolicy { CHECK_IN_ONLY }`, `EventResponsibility { EVENT_LEAD OPERATIONS MARKETING }`, `RegistrationStatus { CONFIRMED WAITLISTED CANCELLED CHECKED_IN ATTENDED NO_SHOW REMOVED }`, `RegistrationSource { SELF ADMIN_OVERRIDE }`.
- Constraints created here, named exactly: `event_capacity_bounds`, `event_time_window`, `event_registration_window`, `event_check_in_window`, `event_registration_one_open_per_user`.
- `Event.confirmedCount` is the denormalised counter the capacity `CHECK` guards. Registration services in Stage 7 must maintain it inside the same transaction as the insert.

- [ ] **Step 1: Write the failing test**

`apps/api/test/schema/events.integration.test.ts`:

```ts
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestPrisma, disconnectTestPrisma, truncateAll } from '../db';

const prisma = createTestPrisma();

afterAll(async () => { await disconnectTestPrisma(prisma); });
beforeEach(async () => { await truncateAll(prisma); });

let seq = 0;
const uniq = () => `${Date.now()}-${seq++}-${Math.random().toString(36).slice(2)}`;
const at = (hoursFromNow: number) => new Date(Date.now() + hoursFromNow * 3_600_000);

async function aUser() {
  return prisma.user.create({
    data: { email: `u.${uniq()}@uni.ac.ae`, passwordHash: 'x', fullName: 'User' },
  });
}

async function aClub() {
  const department = await prisma.department.create({
    data: { name: `Dept ${uniq()}`, code: `D${uniq()}` },
  });
  return prisma.club.create({
    data: {
      departmentId: department.id,
      name: `Club ${uniq()}`,
      slug: `club-${uniq()}`,
      description: 'A club.',
      category: 'Technology',
      academicYear: '2026/2027',
      logoUrl: 'https://example.test/logo.png',
    },
  });
}

async function anEvent(over: Record<string, unknown> = {}) {
  const club = (over.clubId as string | undefined) ? null : await aClub();
  const creator = await aUser();
  return prisma.event.create({
    data: {
      clubId: (over.clubId as string) ?? club!.id,
      title: `Event ${uniq()}`,
      slug: (over.slug as string) ?? `event-${uniq()}`,
      summary: 'A summary.',
      description: 'A description.',
      eventType: 'WORKSHOP',
      audience: 'ALL_STUDENTS',
      venue: 'Hall A',
      startsAt: at(24),
      endsAt: at(26),
      registrationOpensAt: at(1),
      registrationClosesAt: at(23),
      checkInOpensAt: at(23),
      checkInClosesAt: at(26.5),
      capacity: 2,
      createdById: creator.id,
      ...over,
    },
  });
}

describe('Event', () => {
  it('is DRAFT on creation with a zero confirmed count', async () => {
    const event = await anEvent();
    expect(event.status).toBe('DRAFT');
    expect(event.confirmedCount).toBe(0);
    expect(event.attendancePolicy).toBe('CHECK_IN_ONLY');
  });

  it('defaults the timezone to Asia/Dubai', async () => {
    expect((await anEvent()).timezone).toBe('Asia/Dubai');
  });

  it('rejects a confirmed count above capacity', async () => {
    const event = await anEvent({ capacity: 2 });
    await expect(
      prisma.event.update({ where: { id: event.id }, data: { confirmedCount: 3 } }),
    ).rejects.toThrow(/event_capacity_bounds/);
  });

  it('rejects an event created with zero capacity', async () => {
    // capacity > 0 is the third conjunct of event_capacity_bounds and is
    // otherwise untested â both other capacity tests only vary the counter.
    await expect(anEvent({ capacity: 0 })).rejects.toThrow(/event_capacity_bounds/);
  });

  it('allows registration to close exactly when the event ends', async () => {
    // The predicate is registration_closes_at <= ends_at. This boundary case
    // is what distinguishes it from a stricter <.
    await expect(anEvent({ registrationClosesAt: at(26), endsAt: at(26) })).resolves.toBeDefined();
  });

  it('rejects a negative confirmed count', async () => {
    const event = await anEvent();
    await expect(
      prisma.event.update({ where: { id: event.id }, data: { confirmedCount: -1 } }),
    ).rejects.toThrow(/event_capacity_bounds/);
  });

  it('rejects an event that ends before it starts', async () => {
    await expect(anEvent({ startsAt: at(30), endsAt: at(29) })).rejects.toThrow(/event_time_window/);
  });

  it('rejects a registration window that closes before it opens', async () => {
    await expect(anEvent({ registrationOpensAt: at(20), registrationClosesAt: at(19) }))
      .rejects.toThrow(/event_registration_window/);
  });

  it('rejects registration closing after the event ends', async () => {
    await expect(anEvent({ registrationClosesAt: at(40) })).rejects.toThrow(/event_registration_window/);
  });

  it('rejects a check-in window that closes before it opens', async () => {
    await expect(anEvent({ checkInOpensAt: at(26), checkInClosesAt: at(25) }))
      .rejects.toThrow(/event_check_in_window/);
  });

  it('scopes slug uniqueness to the club, so two clubs may both run "orientation"', async () => {
    const [c1, c2] = [await aClub(), await aClub()];
    await anEvent({ clubId: c1.id, slug: 'orientation' });
    await expect(anEvent({ clubId: c2.id, slug: 'orientation' })).resolves.toBeDefined();
  });

  it('rejects a duplicate slug within one club', async () => {
    const club = await aClub();
    await anEvent({ clubId: club.id, slug: 'orientation' });
    await expect(anEvent({ clubId: club.id, slug: 'orientation' }))
      .rejects.toMatchObject({ code: 'P2002' });
  });
});

describe('EventRegistration — one open registration per (user, event)', () => {
  async function register(eventId: string, userId: string, status: 'CONFIRMED' | 'WAITLISTED' | 'CANCELLED' | 'REMOVED' | 'NO_SHOW') {
    return prisma.eventRegistration.create({ data: { eventId, userId, status } });
  }

  it('scopes the rule per user and per event', async () => {
    // Without this, an index on (event_id) alone would cap each event at one
    // registrant, and one on (user_id) alone would let a student register
    // only once ever — both would pass every other test in this block.
    const event = await anEvent();
    const [a, b] = [await aUser(), await aUser()];
    await register(event.id, a.id, 'CONFIRMED');

    // a different student may register for the same event
    await expect(register(event.id, b.id, 'CONFIRMED')).resolves.toBeDefined();

    // and the same student may register for a different event
    const other = await anEvent();
    await expect(register(other.id, a.id, 'CONFIRMED')).resolves.toBeDefined();
  });

  it('rejects a second CONFIRMED registration', async () => {
    const event = await anEvent();
    const user = await aUser();
    await register(event.id, user.id, 'CONFIRMED');
    await expect(register(event.id, user.id, 'CONFIRMED')).rejects.toMatchObject({ code: 'P2002' });
  });

  it('rejects a WAITLISTED row when the student is already CONFIRMED', async () => {
    const event = await anEvent();
    const user = await aUser();
    await register(event.id, user.id, 'CONFIRMED');
    await expect(register(event.id, user.id, 'WAITLISTED')).rejects.toMatchObject({ code: 'P2002' });
  });

  it('allows re-registration after cancelling, preserving the cancelled row', async () => {
    const event = await anEvent();
    const user = await aUser();
    await register(event.id, user.id, 'CANCELLED');
    await expect(register(event.id, user.id, 'CONFIRMED')).resolves.toBeDefined();
    expect(await prisma.eventRegistration.count()).toBe(2);
  });

  it('blocks a REMOVED student from re-registering themselves', async () => {
    const event = await anEvent();
    const user = await aUser();
    await register(event.id, user.id, 'REMOVED');
    await expect(register(event.id, user.id, 'CONFIRMED')).rejects.toMatchObject({ code: 'P2002' });
  });

  it('blocks re-registration after a NO_SHOW', async () => {
    const event = await anEvent();
    const user = await aUser();
    await register(event.id, user.id, 'NO_SHOW');
    await expect(register(event.id, user.id, 'CONFIRMED')).rejects.toMatchObject({ code: 'P2002' });
  });
});

describe('EventAssignment', () => {
  it('lets a Lead grant scan rights for one event without a standing appointment', async () => {
    const event = await anEvent();
    const [member, lead] = [await aUser(), await aUser()];
    const assignment = await prisma.eventAssignment.create({
      data: { eventId: event.id, userId: member.id, responsibility: 'OPERATIONS', assignedById: lead.id },
    });
    expect(assignment.responsibility).toBe('OPERATIONS');
  });

  it('rejects the same person being assigned the same responsibility twice', async () => {
    const event = await anEvent();
    const [member, lead] = [await aUser(), await aUser()];
    const data = { eventId: event.id, userId: member.id, responsibility: 'OPERATIONS' as const, assignedById: lead.id };
    await prisma.eventAssignment.create({ data });
    await expect(prisma.eventAssignment.create({ data })).rejects.toMatchObject({ code: 'P2002' });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @majlis/api test:integration test/schema/events.integration.test.ts`
Expected: FAIL — `prisma.event` is undefined.

- [ ] **Step 3: Add the models to the schema**

Append to `apps/api/prisma/schema.prisma`:

```prisma
enum EventStatus {
  DRAFT
  PUBLISHED
  REGISTRATION_CLOSED
  ONGOING
  COMPLETED
  CERTIFIED
  CANCELLED

  @@map("event_status")
}

/// Extensible. CHECK_IN_AND_OUT and MINIMUM_DURATION are a later additive
/// stage; no columns for them are added now.
enum AttendancePolicy {
  CHECK_IN_ONLY

  @@map("attendance_policy")
}

enum EventResponsibility {
  EVENT_LEAD
  OPERATIONS
  MARKETING

  @@map("event_responsibility")
}

enum RegistrationStatus {
  CONFIRMED
  WAITLISTED
  CANCELLED
  CHECKED_IN
  ATTENDED
  NO_SHOW
  REMOVED

  @@map("registration_status")
}

enum RegistrationSource {
  SELF
  ADMIN_OVERRIDE

  @@map("registration_source")
}

/// A Lead publishing an event makes it live immediately — there is no approval
/// gate. Status beyond DRAFT/PUBLISHED/CANCELLED is a pure function of the
/// timestamp columns, which is what makes the lazy lifecycle possible.
model Event {
  id                   String           @id @default(uuid(7)) @db.Uuid
  clubId               String           @map("club_id") @db.Uuid
  title                String
  slug                 String
  summary              String
  description          String
  eventType            String           @map("event_type")
  audience             String
  venue                String?
  onlineUrl            String?          @map("online_url")
  bannerUrl            String?          @map("banner_url")
  timezone             String           @default("Asia/Dubai")
  startsAt             DateTime         @map("starts_at") @db.Timestamptz(3)
  endsAt               DateTime         @map("ends_at") @db.Timestamptz(3)
  registrationOpensAt  DateTime         @map("registration_opens_at") @db.Timestamptz(3)
  registrationClosesAt DateTime         @map("registration_closes_at") @db.Timestamptz(3)
  checkInOpensAt       DateTime         @map("check_in_opens_at") @db.Timestamptz(3)
  checkInClosesAt      DateTime         @map("check_in_closes_at") @db.Timestamptz(3)
  capacity             Int
  confirmedCount       Int              @default(0) @map("confirmed_count")
  waitlistEnabled      Boolean          @default(true) @map("waitlist_enabled")
  requiresClubMembership Boolean        @default(false) @map("requires_club_membership")
  eligibilityRules     Json?            @map("eligibility_rules")
  certificateEnabled   Boolean          @default(false) @map("certificate_enabled")
  certificateTitle     String?          @map("certificate_title")
  certificateSignatory String?          @map("certificate_signatory")
  attendancePolicy     AttendancePolicy @default(CHECK_IN_ONLY) @map("attendance_policy")
  status               EventStatus      @default(DRAFT)
  cancelledReason      String?          @map("cancelled_reason")
  createdById          String           @map("created_by_id") @db.Uuid
  createdAt            DateTime         @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt            DateTime         @updatedAt @map("updated_at") @db.Timestamptz(3)

  club          Club                @relation(fields: [clubId], references: [id], onDelete: Restrict)
  assignments   EventAssignment[]
  registrations EventRegistration[]

  @@unique([clubId, slug])
  @@index([status, startsAt])
  @@index([clubId, status])
  @@map("event")
}

/// Per-event operational responsibility. This is how a Lead grants scan rights
/// for a single event without creating a standing officer appointment.
model EventAssignment {
  id             String              @id @default(uuid(7)) @db.Uuid
  eventId        String              @map("event_id") @db.Uuid
  userId         String              @map("user_id") @db.Uuid
  responsibility EventResponsibility
  assignedById   String              @map("assigned_by_id") @db.Uuid
  createdAt      DateTime            @default(now()) @map("created_at") @db.Timestamptz(3)

  event Event @relation(fields: [eventId], references: [id], onDelete: Cascade)
  user User @relation(fields: [userId], references: [id], onDelete: Restrict)

  @@unique([eventId, userId, responsibility])
  @@index([userId])
  @@map("event_assignment")
}

model EventRegistration {
  id              String             @id @default(uuid(7)) @db.Uuid
  eventId         String             @map("event_id") @db.Uuid
  userId          String             @map("user_id") @db.Uuid
  status          RegistrationStatus @default(CONFIRMED)
  waitlistPosition Int?              @map("waitlist_position")
  registeredAt    DateTime           @default(now()) @map("registered_at") @db.Timestamptz(3)
  cancelledAt     DateTime?          @map("cancelled_at") @db.Timestamptz(3)
  cancelledById   String?            @map("cancelled_by_id") @db.Uuid
  promotedAt      DateTime?          @map("promoted_at") @db.Timestamptz(3)
  source          RegistrationSource @default(SELF)
  overrideReason  String?            @map("override_reason")

  event Event @relation(fields: [eventId], references: [id], onDelete: Cascade)
  user User @relation(fields: [userId], references: [id], onDelete: Restrict)

  @@index([eventId, status])
  @@index([userId, status])
  @@index([eventId, waitlistPosition])
  @@map("event_registration")
}
```

Add the matching back-relations to `User` (modify the existing model):

```prisma
  registrations    EventRegistration[]
  eventAssignments EventAssignment[]
```

And to `Club` — Prisma requires the other side of the `Event.club` relation, and validation fails without it:

```prisma
  events Event[]
```

- [ ] **Step 4: Generate the migration and add the CHECK constraints and partial index**

```bash
cd apps/api
pnpm prisma migrate dev --name events --create-only
```

Append to the generated `migration.sql`:

```sql
-- Capacity is never exceeded. The counter is maintained inside the same
-- transaction as the registration insert; this CHECK is the backstop that
-- makes an over-sell impossible even if that code is wrong.
ALTER TABLE "event"
  ADD CONSTRAINT "event_capacity_bounds"
  CHECK ("capacity" > 0 AND "confirmed_count" >= 0 AND "confirmed_count" <= "capacity");

ALTER TABLE "event"
  ADD CONSTRAINT "event_time_window"
  CHECK ("starts_at" < "ends_at");

ALTER TABLE "event"
  ADD CONSTRAINT "event_registration_window"
  CHECK ("registration_opens_at" < "registration_closes_at"
     AND "registration_closes_at" <= "ends_at");

ALTER TABLE "event"
  ADD CONSTRAINT "event_check_in_window"
  CHECK ("check_in_opens_at" < "check_in_closes_at");

-- One open registration per (user, event). Only CANCELLED is excluded: a
-- student who cancels may register again while the window is open, but a
-- REMOVED or NO_SHOW student may not re-register themselves.
CREATE UNIQUE INDEX "event_registration_one_open_per_user"
  ON "event_registration" ("event_id", "user_id")
  WHERE "status" <> 'CANCELLED';
```

Apply and regenerate:

```bash
pnpm prisma migrate dev
pnpm prisma generate
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @majlis/api test:integration test/schema/events.integration.test.ts`
Expected: PASS — 20 tests.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(api): event, assignment and registration models

Capacity, time-window and registration-window invariants are CHECK
constraints; one-open-registration-per-user is a partial unique index.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Schema — attendance and certificates (QrPass, AttendanceRecord, Certificate)

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/<ts>_attendance_certificates/migration.sql`
- Test: `apps/api/test/schema/attendance.integration.test.ts`

**Interfaces:**
- Consumes: `User`, `Event`, `EventRegistration` from Tasks 5 and 7.
- Produces: models `QrPass`, `AttendanceRecord`, `Certificate`; enums `AttendanceMethod { QR_SCAN MANUAL }`, `CertificateStatus { ACTIVE REVOKED }`.
- Constraint created here, named exactly: `certificate_one_active_per_registration`.
- `QrPass.tokenVersion` starts at 1 and is bumped by rotation. **No raw token is ever stored** — only the version the signature commits to.

- [ ] **Step 1: Write the failing test**

`apps/api/test/schema/attendance.integration.test.ts`:

```ts
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestPrisma, disconnectTestPrisma, truncateAll } from '../db';

const prisma = createTestPrisma();

afterAll(async () => { await disconnectTestPrisma(prisma); });
beforeEach(async () => { await truncateAll(prisma); });

let seq = 0;
const uniq = () => `${Date.now()}-${seq++}-${Math.random().toString(36).slice(2)}`;
const at = (h: number) => new Date(Date.now() + h * 3_600_000);

async function aUser() {
  return prisma.user.create({
    data: { email: `u.${uniq()}@uni.ac.ae`, passwordHash: 'x', fullName: 'Layla Hassan' },
  });
}

async function aRegistration() {
  const department = await prisma.department.create({
    data: { name: `Dept ${uniq()}`, code: `D${uniq()}` },
  });
  const club = await prisma.club.create({
    data: {
      departmentId: department.id,
      name: `Club ${uniq()}`,
      slug: `club-${uniq()}`,
      description: 'A club.',
      category: 'Technology',
      academicYear: '2026/2027',
      logoUrl: 'https://example.test/logo.png',
    },
  });
  const creator = await aUser();
  const event = await prisma.event.create({
    data: {
      clubId: club.id,
      title: 'Workshop',
      slug: `event-${uniq()}`,
      summary: 's',
      description: 'd',
      eventType: 'WORKSHOP',
      audience: 'ALL_STUDENTS',
      startsAt: at(24),
      endsAt: at(26),
      registrationOpensAt: at(1),
      registrationClosesAt: at(23),
      checkInOpensAt: at(23),
      checkInClosesAt: at(26.5),
      capacity: 10,
      certificateEnabled: true,
      createdById: creator.id,
    },
  });
  const user = await aUser();
  const registration = await prisma.eventRegistration.create({
    data: { eventId: event.id, userId: user.id, status: 'CONFIRMED' },
  });
  return { club, event, user, registration };
}

describe('QrPass', () => {
  it('is one per user and starts at version 1', async () => {
    const user = await aUser();
    const pass = await prisma.qrPass.create({ data: { userId: user.id } });
    expect(pass.tokenVersion).toBe(1);
  });

  it('rejects a second pass for the same user', async () => {
    const user = await aUser();
    await prisma.qrPass.create({ data: { userId: user.id } });
    await expect(prisma.qrPass.create({ data: { userId: user.id } }))
      .rejects.toMatchObject({ code: 'P2002' });
  });

  it('stores no token column at all, only the version', async () => {
    const cols = await prisma.$queryRaw<{ column_name: string }[]>`
      SELECT column_name FROM information_schema.columns WHERE table_name = 'qr_pass'`;
    // Asserts the EXACT column set rather than matching on the substring
    // "token". A raw secret named `signature`, `qr_secret` or `raw_code`
    // would sail past a substring check, and this test is the only
    // automated defence of the no-raw-token guarantee.
    expect(cols.map((c) => c.column_name).sort()).toEqual([
      'id',
      'issued_at',
      'last_rotated_at',
      'token_version',
      'user_id',
    ]);
  });
});

describe('AttendanceRecord', () => {
  it('records a check-in with the scanner and method', async () => {
    const { event, user, registration } = await aRegistration();
    const scanner = await aUser();
    const record = await prisma.attendanceRecord.create({
      data: {
        registrationId: registration.id,
        eventId: event.id,
        userId: user.id,
        checkedInById: scanner.id,
        method: 'QR_SCAN',
      },
    });
    expect(record.method).toBe('QR_SCAN');
    expect(record.checkedInAt).toBeInstanceOf(Date);
  });

  it('scopes attendance per registration, not per event — a queue of students all check in', async () => {
    // The catastrophic failure this guards against: a unique index on
    // event_id instead of registration_id would pass every other test here
    // while allowing exactly one check-in per event, ever.
    const { event, user, registration } = await aRegistration();
    const scanner = await aUser();
    await prisma.attendanceRecord.create({
      data: { registrationId: registration.id, eventId: event.id, userId: user.id, checkedInById: scanner.id, method: 'QR_SCAN' },
    });

    const second = await aUser();
    const secondReg = await prisma.eventRegistration.create({
      data: { eventId: event.id, userId: second.id, status: 'CONFIRMED' },
    });

    await expect(
      prisma.attendanceRecord.create({
        data: { registrationId: secondReg.id, eventId: event.id, userId: second.id, checkedInById: scanner.id, method: 'QR_SCAN' },
      }),
    ).resolves.toBeDefined();
  });

  it('scopes attendance per registration, not per user — one student attends two events', async () => {
    // The mirror image of the event-scoping catastrophe: a unique index on
    // user_id would let a student check in to exactly one event for their
    // entire time at the university. Every other test here passes either way.
    const first = await aRegistration();
    const scanner = await aUser();
    await prisma.attendanceRecord.create({
      data: {
        registrationId: first.registration.id,
        eventId: first.event.id,
        userId: first.user.id,
        checkedInById: scanner.id,
        method: 'QR_SCAN',
      },
    });

    const second = await aRegistration();
    const secondReg = await prisma.eventRegistration.create({
      data: { eventId: second.event.id, userId: first.user.id, status: 'CONFIRMED' },
    });

    await expect(
      prisma.attendanceRecord.create({
        data: {
          registrationId: secondReg.id,
          eventId: second.event.id,
          userId: first.user.id,
          checkedInById: scanner.id,
          method: 'QR_SCAN',
        },
      }),
    ).resolves.toBeDefined();
  });

  it('makes a double check-in impossible, even from two simultaneous scanners', async () => {
    const { event, user, registration } = await aRegistration();
    const scanner = await aUser();
    const data = {
      registrationId: registration.id,
      eventId: event.id,
      userId: user.id,
      checkedInById: scanner.id,
      method: 'QR_SCAN' as const,
    };
    await prisma.attendanceRecord.create({ data });
    await expect(prisma.attendanceRecord.create({ data })).rejects.toMatchObject({ code: 'P2002' });
  });
});

describe('Certificate', () => {
  function certData(over: Record<string, unknown>) {
    return {
      serialNumber: `MJL-${uniq()}`,
      verificationCode: `VC${uniq()}`.replace(/[^A-Z0-9]/gi, '').toUpperCase(),
      holderNameSnapshot: 'Layla Hassan',
      eventTitleSnapshot: 'Workshop',
      clubNameSnapshot: 'Robotics Club',
      clubLogoSnapshotUrl: 'https://example.test/logo.png',
      ...over,
    };
  }

  it('snapshots holder, event, club and logo at issuance', async () => {
    const { event, user, registration } = await aRegistration();
    const cert = await prisma.certificate.create({
      data: certData({ registrationId: registration.id, eventId: event.id, userId: user.id }),
    });
    expect(cert.status).toBe('ACTIVE');
    expect(cert.clubLogoSnapshotUrl).toBe('https://example.test/logo.png');
    expect(cert.pdfUrl).toBeNull(); // rendered lazily on first download
  });

  it('scopes certificates per registration — two attendees of one event each get one', async () => {
    const { event, user, registration } = await aRegistration();
    await prisma.certificate.create({
      data: certData({ registrationId: registration.id, eventId: event.id, userId: user.id }),
    });

    const second = await aUser();
    const secondReg = await prisma.eventRegistration.create({
      data: { eventId: event.id, userId: second.id, status: 'CONFIRMED' },
    });

    await expect(
      prisma.certificate.create({
        data: certData({ registrationId: secondReg.id, eventId: event.id, userId: second.id }),
      }),
    ).resolves.toBeDefined();
  });

  it('rejects a second ACTIVE certificate for one registration, so re-running issuance is safe', async () => {
    const { event, user, registration } = await aRegistration();
    const base = { registrationId: registration.id, eventId: event.id, userId: user.id };
    await prisma.certificate.create({ data: certData(base) });
    await expect(prisma.certificate.create({ data: certData(base) }))
      .rejects.toMatchObject({ code: 'P2002' });
  });

  it('allows a reissue once the previous certificate is REVOKED, keeping both verifiable', async () => {
    const { event, user, registration } = await aRegistration();
    const base = { registrationId: registration.id, eventId: event.id, userId: user.id };
    const first = await prisma.certificate.create({ data: certData(base) });
    await prisma.certificate.update({
      where: { id: first.id },
      data: { status: 'REVOKED', revokedAt: new Date(), revokedReason: 'Name corrected' },
    });
    await expect(prisma.certificate.create({ data: certData(base) })).resolves.toBeDefined();
    expect(await prisma.certificate.count()).toBe(2);
  });

  it('rejects a duplicate serial number', async () => {
    // serial_number is the certificate's human-facing identifier and is
    // @unique exactly as verification_code is; only one of the two symmetric
    // guarantees was covered.
    const a = await aRegistration();
    const b = await aRegistration();
    const serial = 'MJL-SHARED-0001';

    await prisma.certificate.create({
      data: certData({
        registrationId: a.registration.id,
        eventId: a.event.id,
        userId: a.user.id,
        serialNumber: serial,
      }),
    });

    await expect(
      prisma.certificate.create({
        data: certData({
          registrationId: b.registration.id,
          eventId: b.event.id,
          userId: b.user.id,
          serialNumber: serial,
        }),
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('rejects a duplicate verification code', async () => {
    const a = await aRegistration();
    const b = await aRegistration();
    const code = 'SHAREDCODE123';
    await prisma.certificate.create({
      data: certData({ registrationId: a.registration.id, eventId: a.event.id, userId: a.user.id, verificationCode: code }),
    });
    await expect(
      prisma.certificate.create({
        data: certData({ registrationId: b.registration.id, eventId: b.event.id, userId: b.user.id, verificationCode: code }),
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @majlis/api test:integration test/schema/attendance.integration.test.ts`
Expected: FAIL — `prisma.qrPass` is undefined.

- [ ] **Step 3: Add the models to the schema**

Append to `apps/api/prisma/schema.prisma`:

```prisma
enum AttendanceMethod {
  QR_SCAN
  MANUAL

  @@map("attendance_method")
}

enum CertificateStatus {
  ACTIVE
  REVOKED

  @@map("certificate_status")
}

/// One persistent identity pass per user. The QR carries a signed token of
/// { userId, tokenVersion, issuedAt } and nothing else — no event data, no
/// personal data. Only the version is persisted; the raw token never is.
/// Rotation bumps tokenVersion, which every scan re-checks, so previously
/// issued images die immediately.
model QrPass {
  id            String    @id @default(uuid(7)) @db.Uuid
  userId        String    @unique @map("user_id") @db.Uuid
  tokenVersion  Int       @default(1) @map("token_version")
  issuedAt      DateTime  @default(now()) @map("issued_at") @db.Timestamptz(3)
  lastRotatedAt DateTime? @map("last_rotated_at") @db.Timestamptz(3)

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@map("qr_pass")
}

/// One row per registration, ever. The unique constraint on registrationId is
/// what makes a repeated scan return "already checked in" instead of creating
/// a second record — including when two operators scan at the same instant.
model AttendanceRecord {
  id                String           @id @default(uuid(7)) @db.Uuid
  registrationId    String           @unique @map("registration_id") @db.Uuid
  eventId           String           @map("event_id") @db.Uuid
  userId            String           @map("user_id") @db.Uuid
  checkedInAt       DateTime         @default(now()) @map("checked_in_at") @db.Timestamptz(3)
  checkedInById     String           @map("checked_in_by_id") @db.Uuid
  method            AttendanceMethod
  deviceHint        String?          @map("device_hint")
  manualReason      String?          @map("manual_reason")
  correctedAt       DateTime?        @map("corrected_at") @db.Timestamptz(3)
  correctedById     String?          @map("corrected_by_id") @db.Uuid
  correctionReason  String?          @map("correction_reason")

  registration EventRegistration @relation(fields: [registrationId], references: [id], onDelete: Cascade)
  user User @relation(fields: [userId], references: [id], onDelete: Restrict)
  event Event @relation(fields: [eventId], references: [id], onDelete: Restrict)

  @@index([eventId])
  @@index([userId])
  @@map("attendance_record")
}

/// Snapshots are taken at issuance so a later club rename or rebrand cannot
/// retroactively alter an already-issued certificate. pdfUrl stays null until
/// the document is first downloaded and rendered.
model Certificate {
  id                  String            @id @default(uuid(7)) @db.Uuid
  registrationId      String            @map("registration_id") @db.Uuid
  eventId             String            @map("event_id") @db.Uuid
  userId              String            @map("user_id") @db.Uuid
  serialNumber        String            @unique @map("serial_number")
  verificationCode    String            @unique @map("verification_code")
  status              CertificateStatus @default(ACTIVE)
  holderNameSnapshot  String            @map("holder_name_snapshot")
  eventTitleSnapshot  String            @map("event_title_snapshot")
  clubNameSnapshot    String            @map("club_name_snapshot")
  clubLogoSnapshotUrl String            @map("club_logo_snapshot_url")
  issuedAt            DateTime          @default(now()) @map("issued_at") @db.Timestamptz(3)
  pdfUrl              String?           @map("pdf_url")
  revokedAt           DateTime?         @map("revoked_at") @db.Timestamptz(3)
  revokedById         String?           @map("revoked_by_id") @db.Uuid
  revokedReason       String?           @map("revoked_reason")

  registration EventRegistration @relation(fields: [registrationId], references: [id], onDelete: Restrict)
  user User @relation(fields: [userId], references: [id], onDelete: Restrict)
  event Event @relation(fields: [eventId], references: [id], onDelete: Restrict)

  @@index([userId, status])
  @@index([eventId])
  @@map("certificate")
}
```

Add the back-relations to `EventRegistration` (modify the existing model):

```prisma
  attendance   AttendanceRecord?
  certificates Certificate[]
```

And to `User`:

```prisma
  qrPass       QrPass?
  attendance   AttendanceRecord[]
  certificates Certificate[]
```

And to `Event`:

```prisma
  attendance   AttendanceRecord[]
  certificates Certificate[]
```

- [ ] **Step 4: Generate the migration and add the partial unique index**

```bash
cd apps/api
pnpm prisma migrate dev --name attendance_certificates --create-only
```

Append to the generated `migration.sql`:

```sql
-- One ACTIVE certificate per registration. This is what makes the issuance
-- job idempotent: running it twice cannot create a duplicate. REVOKED rows
-- are excluded so a reissue is possible and both remain verifiable.
CREATE UNIQUE INDEX "certificate_one_active_per_registration"
  ON "certificate" ("registration_id")
  WHERE "status" = 'ACTIVE';
```

Apply and regenerate:

```bash
pnpm prisma migrate dev
pnpm prisma generate
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @majlis/api test:integration test/schema/attendance.integration.test.ts`
Expected: PASS — 13 tests.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(api): QR pass, attendance and certificate models

One pass per user with no stored token; one attendance record per
registration; one active certificate per registration, which is what
makes certificate issuance idempotent.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Schema — notifications and the append-only audit log

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/<ts>_notifications_audit/migration.sql`
- Test: `apps/api/test/schema/audit.integration.test.ts`

**Interfaces:**
- Consumes: `User` from Task 5.
- Produces: models `Notification`, `AuditLog`; enums `EmailStatus { PENDING SENT FAILED SKIPPED }`, `AuditOutcome { SUCCESS DENIED }`.
- Produces the SQL function `audit_log_is_append_only()` and triggers `audit_log_no_update` / `audit_log_no_delete`.
- `truncateAll` from Task 4 uses `TRUNCATE`, which the triggers do **not** block (they are `BEFORE UPDATE`/`BEFORE DELETE`), so tests still isolate correctly.

- [ ] **Step 1: Write the failing test**

`apps/api/test/schema/audit.integration.test.ts`:

```ts
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestPrisma, disconnectTestPrisma, truncateAll } from '../db';

const prisma = createTestPrisma();

afterAll(async () => { await disconnectTestPrisma(prisma); });
beforeEach(async () => { await truncateAll(prisma); });

let seq = 0;
const uniq = () => `${Date.now()}-${seq++}-${Math.random().toString(36).slice(2)}`;

async function aUser() {
  return prisma.user.create({
    data: { email: `u.${uniq()}@uni.ac.ae`, passwordHash: 'x', fullName: 'User' },
  });
}

async function anAuditRow() {
  const actor = await aUser();
  return prisma.auditLog.create({
    data: {
      actorUserId: actor.id,
      action: 'club.suspend',
      entityType: 'Club',
      entityId: '00000000-0000-7000-8000-000000000001',
      outcome: 'SUCCESS',
      reason: 'Repeated policy breach',
      before: { status: 'ACTIVE' },
      after: { status: 'SUSPENDED' },
      requestId: 'req-1',
    },
  });
}

describe('AuditLog', () => {
  it('stores before and after snapshots as JSON', async () => {
    const row = await anAuditRow();
    // Re-read rather than trusting the object create() echoes back, so this
    // proves the JSON was actually persisted.
    const persisted = await prisma.auditLog.findUniqueOrThrow({ where: { id: row.id } });
    expect(persisted.before).toEqual({ status: 'ACTIVE' });
    expect(persisted.after).toEqual({ status: 'SUSPENDED' });
  });

  it('records a denial as well as a success', async () => {
    const actor = await aUser();
    const row = await prisma.auditLog.create({
      data: {
        actorUserId: actor.id,
        action: 'event.publish',
        entityType: 'Event',
        entityId: '00000000-0000-7000-8000-000000000002',
        outcome: 'DENIED',
        requestId: 'req-2',
      },
    });
    expect(row.outcome).toBe('DENIED');
  });

  it('is append-only: UPDATE is rejected by the database', async () => {
    const row = await anAuditRow();
    await expect(
      prisma.auditLog.update({ where: { id: row.id }, data: { reason: 'rewritten' } }),
    ).rejects.toThrow(/append-only/i);
  });

  it('is append-only: DELETE is rejected by the database', async () => {
    const row = await anAuditRow();
    await expect(prisma.auditLog.delete({ where: { id: row.id } })).rejects.toThrow(/append-only/i);
  });

  it('is append-only even for a raw bulk UPDATE that bypasses Prisma', async () => {
    await anAuditRow();
    await expect(prisma.$executeRawUnsafe(`UPDATE "audit_log" SET "reason" = 'x'`))
      .rejects.toThrow(/append-only/i);
  });

  it('rejects an UPDATE matching no rows — proving the trigger is statement-level', async () => {
    // The existing bulk-UPDATE test would also pass against a FOR EACH ROW
    // trigger, since it touches a real row. Only a zero-row statement
    // distinguishes the two, and that is the form a careless bulk migration
    // takes.
    await anAuditRow();
    await expect(
      prisma.$executeRawUnsafe(`UPDATE "audit_log" SET "reason" = 'x' WHERE 1 = 0`),
    ).rejects.toThrow(/append-only/i);
  });

  it('rejects a DELETE matching no rows, for the same reason', async () => {
    await anAuditRow();
    await expect(
      prisma.$executeRawUnsafe(`DELETE FROM "audit_log" WHERE 1 = 0`),
    ).rejects.toThrow(/append-only/i);
  });

  it('survives its actor being deleted, because the trail outlives the account', async () => {
    const row = await anAuditRow();
    await prisma.user.delete({ where: { id: row.actorUserId! } });
    const still = await prisma.auditLog.findUnique({ where: { id: row.id } });
    expect(still).not.toBeNull();
    // The actor id is retained verbatim. There is deliberately no foreign key.
    expect(still!.actorUserId).toBe(row.actorUserId);
  });

  it('has no foreign key on actor_user_id, so nothing can cascade into it', async () => {
    const fks = await prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n
      FROM information_schema.table_constraints
      WHERE table_name = 'audit_log' AND constraint_type = 'FOREIGN KEY'`;
    expect(Number(fks[0]!.n)).toBe(0);
  });
});

describe('Notification', () => {
  it('rejects a duplicate dedupe key for the same user, so a retry cannot double-notify', async () => {
    const user = await aUser();
    const data = {
      userId: user.id,
      type: 'registration.confirmed',
      payload: { eventId: 'e1' },
      dedupeKey: 'registration.confirmed:e1',
    };
    await prisma.notification.create({ data });
    await expect(prisma.notification.create({ data })).rejects.toMatchObject({ code: 'P2002' });
  });

  it('allows the same dedupe key for a different user', async () => {
    const [a, b] = [await aUser(), await aUser()];
    const base = { type: 'event.cancelled', payload: {}, dedupeKey: 'event.cancelled:e1' };
    await prisma.notification.create({ data: { ...base, userId: a.id } });
    await expect(prisma.notification.create({ data: { ...base, userId: b.id } })).resolves.toBeDefined();
  });

  it('cascades away when its user is deleted', async () => {
    // The AuditLog half of this contrast is exercised above; without this the
    // cascade is only ever verified by reading the migration SQL.
    const user = await aUser();
    await prisma.notification.create({
      data: { userId: user.id, type: 'certificate.issued', payload: {}, dedupeKey: `k-${uniq()}` },
    });

    await prisma.user.delete({ where: { id: user.id } });
    expect(await prisma.notification.count()).toBe(0);
  });

  it('starts unread with a PENDING email status', async () => {
    const user = await aUser();
    const n = await prisma.notification.create({
      data: { userId: user.id, type: 'certificate.issued', payload: {}, dedupeKey: `k-${uniq()}` },
    });
    expect(n.readAt).toBeNull();
    expect(n.emailStatus).toBe('PENDING');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @majlis/api test:integration test/schema/audit.integration.test.ts`
Expected: FAIL — `prisma.auditLog` is undefined.

- [ ] **Step 3: Add the models to the schema**

Append to `apps/api/prisma/schema.prisma`:

```prisma
enum EmailStatus {
  PENDING
  SENT
  FAILED
  SKIPPED

  @@map("email_status")
}

enum AuditOutcome {
  SUCCESS
  DENIED

  @@map("audit_outcome")
}

/// Written in the same transaction as the action that triggers it. dedupeKey
/// is unique per user, so a retried action cannot notify twice. A failed email
/// is recorded here and never rolls back the action that caused it.
model Notification {
  id          String      @id @default(uuid(7)) @db.Uuid
  userId      String      @map("user_id") @db.Uuid
  type        String
  payload     Json
  dedupeKey   String      @map("dedupe_key")
  readAt      DateTime?   @map("read_at") @db.Timestamptz(3)
  emailStatus EmailStatus @default(PENDING) @map("email_status")
  emailError  String?     @map("email_error")
  createdAt   DateTime    @default(now()) @map("created_at") @db.Timestamptz(3)

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([userId, dedupeKey])
  @@index([userId, readAt])
  @@map("notification")
}

/// Append-only. Enforced by database triggers, not convention. Never contains
/// a raw QR token, password, session token or refresh token.
///
/// There is deliberately NO foreign key on actorUserId. An audit row is an
/// immutable historical fact, not a live reference: a FK would force either a
/// cascade (destroying the trail) or a SET NULL (an UPDATE, which the
/// append-only trigger must refuse). Storing the id verbatim keeps the trail
/// correct and keeps the trigger absolute.
model AuditLog {
  id          String       @id @default(uuid(7)) @db.Uuid
  actorUserId String?      @map("actor_user_id") @db.Uuid
  action      String
  entityType  String       @map("entity_type")
  entityId    String       @map("entity_id")
  outcome     AuditOutcome
  reason      String?
  before      Json?
  after       Json?
  requestId   String       @map("request_id")
  ip          String?
  createdAt   DateTime     @default(now()) @map("created_at") @db.Timestamptz(3)

  @@index([entityType, entityId])
  @@index([actorUserId])
  @@index([createdAt])
  @@map("audit_log")
}
```

Add the back-relation to `User` (modify the existing model). Note there is **no** `auditLogs` relation — see the comment on `AuditLog`:

```prisma
  notifications Notification[]
```

- [ ] **Step 4: Generate the migration and add the append-only triggers**

```bash
cd apps/api
pnpm prisma migrate dev --name notifications_audit --create-only
```

Append to the generated `migration.sql`:

```sql
-- The audit log is append-only. Application discipline is not enough: a bug,
-- a migration, or a console session must all be refused. Statement-level
-- triggers mean even a bulk UPDATE that touches no rows is rejected.
CREATE OR REPLACE FUNCTION audit_log_is_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only: % is not permitted', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "audit_log_no_update"
  BEFORE UPDATE ON "audit_log"
  FOR EACH STATEMENT EXECUTE FUNCTION audit_log_is_append_only();

CREATE TRIGGER "audit_log_no_delete"
  BEFORE DELETE ON "audit_log"
  FOR EACH STATEMENT EXECUTE FUNCTION audit_log_is_append_only();
```

Apply and regenerate:

```bash
pnpm prisma migrate dev
pnpm prisma generate
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @majlis/api test:integration test/schema/audit.integration.test.ts`
Expected: PASS — 13 tests.

- [ ] **Step 6: Run the whole integration suite to confirm nothing regressed**

Run: `pnpm --filter @majlis/api test:integration`
Expected: PASS — all schema suites green.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(api): notification and append-only audit log models

Append-only is enforced by statement-level triggers, so a bulk UPDATE or
a console session is refused the same way application code would be.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: NestJS application — validated environment, Pino logging, health endpoint

**Files:**
- Create: `apps/api/src/main.ts`, `src/app.module.ts`
- Create: `src/config/env.schema.ts`, `src/config/config.module.ts`
- Create: `src/prisma/prisma.service.ts`, `src/prisma/prisma.module.ts`
- Create: `src/health/health.controller.ts`, `src/health/health.module.ts`
- Test: `src/config/env.schema.spec.ts`, `test/health.integration.test.ts`

**Interfaces:**
- Consumes: `PrismaClient` generated in Task 4; all models from Tasks 5–9.
- Produces:
  - `envSchema: z.ZodObject` and `type Env = z.infer<typeof envSchema>`
  - `PrismaService extends PrismaClient` — injectable, connects on module init
  - `PrismaModule` — global, exports `PrismaService`
  - `AppModule` — the root module
  - `GET /api/v1/health` returning `{ status: 'ok'; database: 'up'; uptimeSeconds: number }`
- The global route prefix is `api/v1`. Every later controller relies on this being set in `main.ts`, not repeated per controller.

- [ ] **Step 0: Point integration tests at the test database, before anything imports**

`@nestjs/config`'s `forRoot()` reads the environment, validates it, and caches the result **at import time** — the moment `config.module.ts` is first imported, which happens as soon as a test file imports `AppModule`. Setting `process.env.DATABASE_URL` inside `beforeAll` is therefore too late: the value is already captured, and `PrismaService` would connect to `majlis_dev`. Integration tests would silently read and write the development database, sailing straight past the `testDatabaseUrl()` guard, and every test would still pass.

Fix it once, globally, with a Vitest setup file that runs before any test module is imported.

Create `apps/api/test/setup-env.ts`:

```ts
// Runs before any test file is imported — which matters, because
// @nestjs/config captures and validates the environment at import time.
// Assigning these inside a beforeAll hook would be too late and the API
// under test would quietly connect to the development database.
if (!process.env.TEST_DATABASE_URL) {
  throw new Error('TEST_DATABASE_URL is not set. Copy .env.example to .env.');
}

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.DIRECT_URL = process.env.TEST_DATABASE_URL;
```

Then register it in `apps/api/vitest.integration.config.ts`, alongside the existing `globalSetup`:

```ts
    setupFiles: ['./test/setup-env.ts'],
```

`dotenv` does not overwrite variables already present in the environment, so these assignments survive `ConfigModule`'s own `.env` loading.

Verify it works before moving on: `pnpm --filter @majlis/api test:integration` must still be green, and adding a temporary `console.error(process.env.DATABASE_URL)` to a test must print the `majlis_test` URL. Remove the temporary line afterwards.

- [ ] **Step 1: Write the failing environment test**

`apps/api/src/config/env.schema.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { envSchema } from './env.schema';

const valid = {
  DATABASE_URL: 'postgresql://majlis:majlis@localhost:5432/majlis_dev?schema=public',
  DIRECT_URL: 'postgresql://majlis:majlis@localhost:5432/majlis_dev?schema=public',
};

describe('envSchema', () => {
  it('applies defaults for the optional variables', () => {
    const env = envSchema.parse(valid);
    expect(env.NODE_ENV).toBe('development');
    expect(env.PORT).toBe(3001);
    expect(env.LOG_LEVEL).toBe('info');
  });

  it('coerces PORT from the string the environment always gives us', () => {
    expect(envSchema.parse({ ...valid, PORT: '8080' }).PORT).toBe(8080);
  });

  it('rejects a missing DATABASE_URL rather than starting a broken server', () => {
    const { DATABASE_URL: _omitted, ...rest } = valid;
    expect(() => envSchema.parse(rest)).toThrow();
  });

  it('rejects a DATABASE_URL that is not a postgres URL', () => {
    expect(() => envSchema.parse({ ...valid, DATABASE_URL: 'mysql://localhost/x' })).toThrow();
  });

  it('accepts the postgres:// scheme as well as postgresql://', () => {
    expect(() => envSchema.parse({ ...valid, DATABASE_URL: 'postgres://a:b@h:5432/d' })).not.toThrow();
  });

  it('rejects an unknown NODE_ENV', () => {
    expect(() => envSchema.parse({ ...valid, NODE_ENV: 'staging' })).toThrow();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @majlis/api test`
Expected: FAIL — cannot resolve `./env.schema`.

- [ ] **Step 3: Implement the environment schema and config module**

`apps/api/src/config/env.schema.ts`:

```ts
import { z } from 'zod';

const postgresUrl = z
  .string()
  .refine((v) => /^postgres(ql)?:\/\//.test(v), { message: 'must be a postgres:// URL' });

/**
 * The process refuses to start if any of this is wrong. A server that boots
 * with a broken configuration and fails on the first request is worse than
 * one that never boots.
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().max(65535).default(3001),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  DATABASE_URL: postgresUrl,
  DIRECT_URL: postgresUrl,
});

export type Env = z.infer<typeof envSchema>;
```

`apps/api/src/config/config.module.ts`:

```ts
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import { envSchema } from './env.schema';

export const ConfigModule = NestConfigModule.forRoot({
  isGlobal: true,
  cache: true,
  envFilePath: ['../../.env'],
  validate: (raw) => envSchema.parse(raw),
});
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter @majlis/api test`
Expected: PASS — 6 tests.

- [ ] **Step 5: Write the failing health test**

`apps/api/test/health.integration.test.ts`:

```ts
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';

let app: INestApplication;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api/v1');
  await app.init();
});

afterAll(async () => {
  await app?.close();
});

describe('GET /api/v1/health', () => {
  it('reports ok with the database up', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/health').expect(200);
    expect(res.body).toMatchObject({ status: 'ok', database: 'up' });
    expect(typeof res.body.uptimeSeconds).toBe('number');
  });

  it('exposes nothing sensitive — no connection string, no secret', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/health').expect(200);
    const body = JSON.stringify(res.body);
    expect(body).not.toMatch(/postgres/i);
    expect(body).not.toMatch(/password/i);
    expect(Object.keys(res.body).sort()).toEqual(['database', 'status', 'uptimeSeconds']);
  });

  it('is served under the api/v1 prefix, not at the root', async () => {
    await request(app.getHttpServer()).get('/health').expect(404);
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `pnpm --filter @majlis/api test:integration test/health.integration.test.ts`
Expected: FAIL — cannot resolve `../src/app.module`.

- [ ] **Step 7: Implement Prisma service, health endpoint, and the root module**

`apps/api/src/prisma/prisma.service.ts`:

```ts
import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';
import type { Env } from '../config/env.schema';

/**
 * Prisma 7 requires a driver adapter. On Vercel the connection string points
 * at Supabase's transaction pooler with connection_limit=1; pgBouncer's
 * transaction mode still supports row locks, so SELECT ... FOR UPDATE and the
 * capacity guarantee are unaffected.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor(config: ConfigService<Env, true>) {
    super({
      adapter: new PrismaPg({ connectionString: config.get('DATABASE_URL', { infer: true }) }),
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
```

`apps/api/src/prisma/prisma.module.ts`:

```ts
import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Global()
@Module({ providers: [PrismaService], exports: [PrismaService] })
export class PrismaModule {}
```

`apps/api/src/health/health.controller.ts`:

```ts
import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../prisma/prisma.service';

@ApiTags('ops')
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Deliberately minimal. The scanner screen pings this on open to warm a
   * cold serverless instance before the first student reaches the door.
   */
  @Get()
  @ApiOkResponse({ description: 'Service and database are reachable.' })
  async check(): Promise<{ status: 'ok'; database: 'up'; uptimeSeconds: number }> {
    await this.prisma.$queryRaw`SELECT 1`;
    return { status: 'ok', database: 'up', uptimeSeconds: Math.round(process.uptime()) };
  }
}
```

`apps/api/src/health/health.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';

@Module({ controllers: [HealthController] })
export class HealthModule {}
```

`apps/api/src/app.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { randomUUID } from 'node:crypto';
import { ConfigModule } from './config/config.module';
import type { Env } from './config/env.schema';
import { HealthModule } from './health/health.module';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [
    ConfigModule,
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        pinoHttp: {
          level: config.get('LOG_LEVEL', { infer: true }),
          genReqId: (req, res) => {
            const id = (req.headers['x-request-id'] as string) ?? randomUUID();
            res.setHeader('x-request-id', id);
            return id;
          },
          // Nothing secret ever reaches a log line.
          redact: {
            paths: [
              'req.headers.cookie',
              'req.headers.authorization',
              'req.body.password',
              'req.body.token',
              'res.headers["set-cookie"]',
            ],
            remove: true,
          },
          transport:
            config.get('NODE_ENV', { infer: true }) === 'development'
              ? { target: 'pino-pretty', options: { singleLine: true } }
              : undefined,
        },
      }),
    }),
    PrismaModule,
    HealthModule,
  ],
})
export class AppModule {}
```

`apps/api/src/main.ts`:

```ts
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import type { Env } from './config/env.schema';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.setGlobalPrefix('api/v1');
  app.enableShutdownHooks();

  const config = app.get(ConfigService<Env, true>);
  await app.listen(config.get('PORT', { infer: true }));
}

void bootstrap();
```

- [ ] **Step 8: Run the health test to verify it passes**

Run: `pnpm --filter @majlis/api test:integration test/health.integration.test.ts`
Expected: PASS — 3 tests.

- [ ] **Step 9: Verify the server actually starts**

Run: `pnpm --filter @majlis/api start:dev`, then in another shell `curl http://localhost:3001/api/v1/health`
Expected: `{"status":"ok","database":"up","uptimeSeconds":N}`. Stop the server.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat(api): NestJS bootstrap with validated env, Pino logging and health

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: Ambient transaction host

**Files:**
- Create: `apps/api/src/prisma/transaction.host.ts`
- Modify: `apps/api/src/prisma/prisma.module.ts` — provide and export `TransactionHost`
- Test: `apps/api/test/transaction-host.integration.test.ts`

**Interfaces:**
- Consumes: `PrismaService` from Task 10.
- Produces `TransactionHost`, injectable, with exactly this surface — every service from Stage 2 onward writes through it:
  - `get tx(): TransactionClient` — the ambient transaction if one is running, otherwise the base client
  - `run<T>(fn: () => Promise<T>): Promise<T>` — starts a transaction, or **joins** the caller's if one is already open
  - `type TransactionClient = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$extends'>`

This is the mechanism that makes *"the audit row is written in the same transaction as the action"* structural. A service does not receive a `tx` parameter and does not have to remember to pass it down.

- [ ] **Step 1: Write the failing test**

`apps/api/test/transaction-host.integration.test.ts`:

```ts
import { ConfigService } from '@nestjs/config';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/prisma/prisma.service';
import { TransactionHost } from '../src/prisma/transaction.host';
import { testDatabaseUrl, truncateAll } from './db';

const config = { get: () => testDatabaseUrl() } as unknown as ConfigService;
const prisma = new PrismaService(config);
const host = new TransactionHost(prisma);

let seq = 0;
const email = () => `tx.${Date.now()}.${seq++}@uni.ac.ae`;

afterAll(async () => { await prisma.$disconnect(); });
// PrismaService extends PrismaClient, so it satisfies truncateAll directly.
beforeEach(async () => { await truncateAll(prisma); });

describe('TransactionHost', () => {
  it('returns the base client when no transaction is running', async () => {
    await host.tx.user.create({ data: { email: email(), passwordHash: 'x', fullName: 'A' } });
    expect(await prisma.user.count()).toBe(1);
  });

  it('commits every write made inside run()', async () => {
    await host.run(async () => {
      await host.tx.user.create({ data: { email: email(), passwordHash: 'x', fullName: 'A' } });
      await host.tx.user.create({ data: { email: email(), passwordHash: 'x', fullName: 'B' } });
    });
    expect(await prisma.user.count()).toBe(2);
  });

  it('rolls back every write when the callback throws', async () => {
    await expect(
      host.run(async () => {
        await host.tx.user.create({ data: { email: email(), passwordHash: 'x', fullName: 'A' } });
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await prisma.user.count()).toBe(0);
  });

  it('joins the ambient transaction rather than opening a nested one', async () => {
    // Simulates an audit writer called deep inside a service: it never
    // receives a tx handle, yet its write must share the outer transaction.
    async function auditWriterDeepInTheStack() {
      await host.tx.auditLog.create({
        data: {
          action: 'user.create',
          entityType: 'User',
          entityId: '00000000-0000-7000-8000-000000000001',
          outcome: 'SUCCESS',
          requestId: 'req-1',
        },
      });
    }

    await expect(
      host.run(async () => {
        await host.tx.user.create({ data: { email: email(), passwordHash: 'x', fullName: 'A' } });
        await host.run(auditWriterDeepInTheStack);
        throw new Error('action failed after auditing');
      }),
    ).rejects.toThrow('action failed after auditing');

    // Both the action and its audit row rolled back together.
    expect(await prisma.user.count()).toBe(0);
    expect(await prisma.auditLog.count()).toBe(0);
  });

  it('isolates concurrent transactions from each other', async () => {
    const results = await Promise.allSettled([
      host.run(async () => {
        await host.tx.user.create({ data: { email: email(), passwordHash: 'x', fullName: 'A' } });
      }),
      host.run(async () => {
        await host.tx.user.create({ data: { email: email(), passwordHash: 'x', fullName: 'B' } });
        throw new Error('second fails');
      }),
    ]);

    expect(results[0]!.status).toBe('fulfilled');
    expect(results[1]!.status).toBe('rejected');
    expect(await prisma.user.count()).toBe(1);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @majlis/api test:integration test/transaction-host.integration.test.ts`
Expected: FAIL — cannot resolve `../src/prisma/transaction.host`.

- [ ] **Step 3: Implement the transaction host**

`apps/api/src/prisma/transaction.host.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from './prisma.service';

/**
 * A Prisma client scoped to a transaction: the connection-level methods are
 * gone. This is Prisma's own type rather than a hand-rolled `Omit`, so it
 * stays exactly in step with whatever `$transaction` actually hands back.
 */
export type TransactionClient = Prisma.TransactionClient;

/**
 * Carries the current transaction implicitly through the call stack.
 *
 * Services read `host.tx` instead of `prisma`, so a helper called five frames
 * down — the audit writer, most importantly — automatically enlists in the
 * caller's transaction without being handed one. That is what makes
 * "the audit row is written in the same transaction as the action" a
 * structural property rather than something a reviewer has to catch.
 */
@Injectable()
export class TransactionHost {
  private readonly storage = new AsyncLocalStorage<TransactionClient>();

  constructor(private readonly prisma: PrismaService) {}

  /** The ambient transaction if one is open, otherwise the base client. */
  get tx(): TransactionClient {
    return this.storage.getStore() ?? this.prisma;
  }

  /**
   * Runs `fn` inside a transaction. If a transaction is already open on this
   * async context, `fn` joins it — Postgres has no true nested transactions,
   * and a savepoint here would let an inner failure be swallowed while the
   * outer action commits, which is exactly the bug this design prevents.
   */
  async run<T>(fn: () => Promise<T>): Promise<T> {
    const ambient = this.storage.getStore();
    if (ambient) return fn();

    return this.prisma.$transaction((tx) => this.storage.run(tx, fn));
  }
}
```

- [ ] **Step 4: Register it in the Prisma module**

`apps/api/src/prisma/prisma.module.ts`:

```ts
import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { TransactionHost } from './transaction.host';

@Global()
@Module({
  providers: [PrismaService, TransactionHost],
  exports: [PrismaService, TransactionHost],
})
export class PrismaModule {}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @majlis/api test:integration test/transaction-host.integration.test.ts`
Expected: PASS — 5 tests.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(api): AsyncLocalStorage ambient transaction host

Services read host.tx rather than a passed-down handle, so an audit write
five frames deep enlists in the caller's transaction automatically.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 12: Problem Details exception filter, Zod pipe, and generated OpenAPI

**Files:**
- Create: `apps/api/src/common/problem/domain-error.ts`, `src/common/problem/problem.filter.ts`
- Create: `apps/api/src/common/openapi.ts`
- Modify: `apps/api/src/main.ts` — register the pipe, the filter, and OpenAPI
- Test: `apps/api/src/common/problem/problem.filter.spec.ts`, `test/problem.integration.test.ts`

**Interfaces:**
- Consumes: `problemDetailsSchema`, `ProblemDetails`, `ProblemFieldError` from `@majlis/contracts` (Task 2).
- Produces:
  - `abstract class DomainError extends Error` with `readonly status: number`, `readonly type: string`, `readonly title: string`
  - Concrete errors used from Stage 2 onward: `NotFoundError`, `ConflictError`, `ForbiddenError`, `UnprocessableError` — each taking `(detail: string)`
  - `ProblemExceptionFilter implements ExceptionFilter` — registered globally
  - `setupOpenApi(app: INestApplication): void` — serves the generated document at `/api/v1/docs`
- Every error response in Majlis is `application/problem+json`. No handler ever returns a bare string or Nest's default error shape.

- [ ] **Step 1: Write the failing unit test**

`apps/api/src/common/problem/problem.filter.spec.ts`:

```ts
import { BadRequestException, HttpStatus, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { ZodValidationException } from 'nestjs-zod';
import { ZodError, z } from 'zod';
import { ConflictError, ForbiddenError, NotFoundError } from './domain-error';
import { ProblemExceptionFilter } from './problem.filter';

function invokeFilter(exception: unknown) {
  const json = vi.fn();
  const status = vi.fn().mockReturnValue({ json });
  const type = vi.fn().mockReturnValue({ status });
  const host = {
    switchToHttp: () => ({
      getResponse: () => ({ type, status, json }),
      getRequest: () => ({ url: '/api/v1/clubs', id: 'req-abc' }),
    }),
  };

  const logger = { error: vi.fn(), warn: vi.fn() };
  const filter = new ProblemExceptionFilter(logger as never);
  filter.catch(exception, host as never);

  return { body: json.mock.calls[0]?.[0], status: status.mock.calls[0]?.[0], type };
}

describe('ProblemExceptionFilter', () => {
  it('sets the application/problem+json content type', () => {
    const { type } = invokeFilter(new NotFoundError('No such club.'));
    expect(type).toHaveBeenCalledWith('application/problem+json');
  });

  it('maps a domain NotFoundError to 404 with its type and title', () => {
    const { body, status } = invokeFilter(new NotFoundError('No such club.'));
    expect(status).toBe(404);
    expect(body).toMatchObject({
      type: 'https://majlis.app/problems/not-found',
      title: 'Not found',
      status: 404,
      detail: 'No such club.',
      instance: '/api/v1/clubs',
      requestId: 'req-abc',
    });
  });

  it('maps a domain ConflictError to 409', () => {
    expect(invokeFilter(new ConflictError('Event is full.')).status).toBe(409);
  });

  it('maps a domain ForbiddenError to 403', () => {
    expect(invokeFilter(new ForbiddenError('Not your club.')).status).toBe(403);
  });

  it('maps a Zod error to 400 with field-level errors', () => {
    const schema = z.object({ name: z.string(), capacity: z.number() });
    let zodError: ZodError;
    try {
      schema.parse({ capacity: 'lots' });
      throw new Error('should not reach');
    } catch (e) {
      zodError = e as ZodError;
    }

    const { body, status } = invokeFilter(zodError!);
    expect(status).toBe(400);
    expect(body.title).toBe('Validation failed');
    expect(body.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'name' }),
        expect.objectContaining({ path: 'capacity' }),
      ]),
    );
  });

  it("maps nestjs-zod's ZodValidationException to 400 WITH field errors", () => {
    // This is the shape the global pipe actually throws. Because it extends
    // BadRequestException, a filter checking HttpException first would return
    // a bare 400 and silently drop every field error.
    const schema = z.object({ title: z.string() });
    let inner: ZodError;
    try {
      schema.parse({});
      throw new Error('should not reach');
    } catch (e) {
      inner = e as ZodError;
    }

    const { body, status } = invokeFilter(new ZodValidationException(inner!));
    expect(status).toBe(400);
    expect(body.title).toBe('Validation failed');
    expect(body.errors).toEqual([expect.objectContaining({ path: 'title' })]);
  });

  it('maps a Prisma unique-violation to 409, not 500 — a lost race is expected, not a fault', () => {
    const p2002 = Object.assign(new Error('Unique constraint failed'), {
      code: 'P2002',
      meta: { target: ['event_id', 'user_id'] },
    });
    const { body, status } = invokeFilter(p2002);
    expect(status).toBe(409);
    expect(body.type).toBe('https://majlis.app/problems/conflict');
  });

  it('maps a Prisma record-not-found (P2025) to 404', () => {
    const p2025 = Object.assign(new Error('Record not found'), { code: 'P2025' });
    expect(invokeFilter(p2025).status).toBe(404);
  });

  it('passes a Nest HttpException through at its own status', () => {
    expect(invokeFilter(new NotFoundException('nope')).status).toBe(404);
    expect(invokeFilter(new BadRequestException('bad')).status).toBe(400);
  });

  it('turns an unknown error into a 500 that leaks nothing', () => {
    const { body, status } = invokeFilter(new Error('DB password is hunter2'));
    expect(status).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(body.detail).toBe('An unexpected error occurred.');
    expect(JSON.stringify(body)).not.toContain('hunter2');
    expect(body.requestId).toBe('req-abc');
  });

  it('logs the real cause of a 500 even though the response hides it', () => {
    const json = vi.fn();
    const status = vi.fn().mockReturnValue({ json });
    const type = vi.fn().mockReturnValue({ status });
    const host = {
      switchToHttp: () => ({
        getResponse: () => ({ type, status, json }),
        getRequest: () => ({ url: '/x', id: 'r' }),
      }),
    };
    const logger = { error: vi.fn(), warn: vi.fn() };
    new ProblemExceptionFilter(logger as never).catch(new Error('hunter2'), host as never);
    expect(logger.error).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @majlis/api test`
Expected: FAIL — cannot resolve `./domain-error` and `./problem.filter`.

- [ ] **Step 3: Implement the domain errors**

`apps/api/src/common/problem/domain-error.ts`:

```ts
/**
 * Business-rule failures. Services throw these; the global filter is the only
 * place that knows how to turn one into an HTTP response, so no service ever
 * imports anything from @nestjs/common to report a rule violation.
 */
export abstract class DomainError extends Error {
  abstract readonly status: number;
  abstract readonly type: string;
  abstract readonly title: string;

  constructor(detail: string) {
    super(detail);
    this.name = new.target.name;
  }
}

export class NotFoundError extends DomainError {
  readonly status = 404;
  readonly type = 'https://majlis.app/problems/not-found';
  readonly title = 'Not found';
}

export class ForbiddenError extends DomainError {
  readonly status = 403;
  readonly type = 'https://majlis.app/problems/forbidden';
  readonly title = 'Forbidden';
}

export class ConflictError extends DomainError {
  readonly status = 409;
  readonly type = 'https://majlis.app/problems/conflict';
  readonly title = 'Conflict';
}

export class UnprocessableError extends DomainError {
  readonly status = 422;
  readonly type = 'https://majlis.app/problems/unprocessable';
  readonly title = 'Unprocessable';
}
```

- [ ] **Step 4: Implement the filter**

`apps/api/src/common/problem/problem.filter.ts`:

```ts
import {
  Catch,
  HttpException,
  HttpStatus,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type { ProblemDetails, ProblemFieldError } from '@majlis/contracts';
import { Logger } from 'nestjs-pino';
import { ZodValidationException } from 'nestjs-zod';
import { ZodError } from 'zod';
import { DomainError } from './domain-error';

const PROBLEM_BASE = 'https://majlis.app/problems';

/** Narrow structural check — avoids importing Prisma error classes here. */
function isPrismaError(e: unknown): e is { code: string; message: string } {
  return typeof e === 'object' && e !== null && typeof (e as { code?: unknown }).code === 'string';
}

/**
 * Validation failures reach us two ways: a bare ZodError from code that parses
 * a schema directly, and a ZodValidationException from nestjs-zod's global
 * pipe, which wraps one. Both must produce the same field-level response.
 */
function asZodError(e: unknown): ZodError | undefined {
  if (e instanceof ZodError) return e;
  if (e instanceof ZodValidationException) {
    const inner = e.getZodError();
    if (inner instanceof ZodError) return inner;
  }
  return undefined;
}

@Catch()
export class ProblemExceptionFilter implements ExceptionFilter {
  constructor(private readonly logger: Logger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const req = http.getRequest<{ url?: string; id?: string }>();
    const res = http.getResponse<{
      type: (t: string) => { status: (s: number) => { json: (b: unknown) => void } };
    }>();

    const problem = this.toProblem(exception, req);

    if (problem.status >= 500) {
      this.logger.error({ err: exception, requestId: problem.requestId }, 'Unhandled exception');
    } else {
      this.logger.warn({ requestId: problem.requestId, status: problem.status }, problem.title);
    }

    res.type('application/problem+json').status(problem.status).json(problem);
  }

  private toProblem(exception: unknown, req: { url?: string; id?: string }): ProblemDetails {
    const base = { instance: req.url, requestId: req.id };

    if (exception instanceof DomainError) {
      return {
        ...base,
        type: exception.type,
        title: exception.title,
        status: exception.status,
        detail: exception.message,
      };
    }

    // MUST come before the HttpException branch: nestjs-zod's
    // ZodValidationException extends BadRequestException, so checking
    // HttpException first would swallow it and drop every field error.
    const zodError = asZodError(exception);
    if (zodError) {
      const errors: ProblemFieldError[] = zodError.issues.map((i) => ({
        path: i.path.join('.'),
        message: i.message,
        code: i.code,
      }));
      return {
        ...base,
        type: `${PROBLEM_BASE}/validation-failed`,
        title: 'Validation failed',
        status: 400,
        detail: 'The request did not match the expected shape.',
        errors,
      };
    }

    if (isPrismaError(exception)) {
      // A lost race on a unique index is an expected outcome under
      // concurrency, not a server fault. It must never surface as a 500.
      if (exception.code === 'P2002') {
        return {
          ...base,
          type: `${PROBLEM_BASE}/conflict`,
          title: 'Conflict',
          status: 409,
          detail: 'This conflicts with an existing record. Reload and try again.',
        };
      }
      if (exception.code === 'P2025') {
        return {
          ...base,
          type: `${PROBLEM_BASE}/not-found`,
          title: 'Not found',
          status: 404,
          detail: 'The requested record does not exist.',
        };
      }
      if (exception.code === 'P2003') {
        return {
          ...base,
          type: `${PROBLEM_BASE}/conflict`,
          title: 'Conflict',
          status: 409,
          detail: 'A referenced record does not exist or is still in use.',
        };
      }
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const response = exception.getResponse();
      const detail =
        typeof response === 'string'
          ? response
          : ((response as { message?: string | string[] }).message as string | undefined);
      return {
        ...base,
        type: `${PROBLEM_BASE}/http-error`,
        title: exception.name.replace(/Exception$/, ''),
        status,
        detail: Array.isArray(detail) ? detail.join('; ') : (detail ?? exception.message),
      };
    }

    // Anything else is a bug. The real cause is logged above; the client
    // gets only a request id to quote.
    return {
      ...base,
      type: `${PROBLEM_BASE}/internal`,
      title: 'Internal server error',
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      detail: 'An unexpected error occurred.',
    };
  }
}
```

- [ ] **Step 5: Run the unit test to verify it passes**

Run: `pnpm --filter @majlis/api test`
Expected: PASS — 17 tests (6 env + 11 filter).

- [ ] **Step 6: Write the failing integration test**

`apps/api/test/problem.integration.test.ts`:

```ts
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Logger } from 'nestjs-pino';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { ProblemExceptionFilter } from '../src/common/problem/problem.filter';

let app: INestApplication;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api/v1');
  app.useGlobalFilters(new ProblemExceptionFilter(app.get(Logger)));
  await app.init();
});

afterAll(async () => { await app?.close(); });

describe('error responses', () => {
  it('returns problem+json for an unknown route', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/nope').expect(404);
    expect(res.headers['content-type']).toMatch(/application\/problem\+json/);
    expect(res.body).toMatchObject({ status: 404, title: expect.any(String) });
    expect(res.body.instance).toBe('/api/v1/nope');
  });

  it('always carries a request id the user can quote', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/nope').expect(404);
    expect(res.body.requestId).toEqual(expect.any(String));
    expect(res.body.requestId.length).toBeGreaterThan(0);
  });

  it('echoes a caller-supplied x-request-id so logs correlate end to end', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/nope')
      .set('x-request-id', 'trace-me-123')
      .expect(404);
    expect(res.body.requestId).toBe('trace-me-123');
  });
});
```

- [ ] **Step 7: Run it to verify it fails**

Run: `pnpm --filter @majlis/api test:integration test/problem.integration.test.ts`
Expected: FAIL — the 404 body is Nest's default shape, missing `requestId` and the problem content type.

- [ ] **Step 8: Wire the filter, the Zod pipe, and OpenAPI into main.ts**

`apps/api/src/common/openapi.ts`:

```ts
import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { cleanupOpenApiDoc } from 'nestjs-zod';

/**
 * The OpenAPI document is generated from the Zod-derived DTOs, never written
 * by hand.
 *
 * nestjs-zod v5 relies on Zod 4's native JSON Schema output, so there is no
 * `patchNestJsSwagger` any more — it was removed in v5. `cleanupOpenApiDoc`
 * post-processes the generated document instead.
 */
export function setupOpenApi(app: INestApplication): void {
  const config = new DocumentBuilder()
    .setTitle('Majlis API')
    .setDescription('University club and event management.')
    .setVersion('1.0')
    .addCookieAuth('majlis_session')
    .build();

  const document = cleanupOpenApiDoc(SwaggerModule.createDocument(app, config));
  SwaggerModule.setup('api/v1/docs', app, document);
}
```

> **Peer-range caveat, verified against the published package.** `nestjs-zod@5.5.0` declares peers of `@nestjs/common ^10 || ^11` and `@nestjs/swagger ^7.4.2 || ^8 || ^11` — it does **not** list NestJS 12. The root `package.json` carries a `pnpm.peerDependencyRules.allowedVersions` override permitting 12, on the judgement that the `PipeTransform` and DTO-class surface did not change between Nest 11 and 12. If `ZodValidationPipe` or `createZodDto` actually misbehaves at runtime, do **not** downgrade NestJS. Fall back to dropping `nestjs-zod`: a `ZodValidationPipe` is roughly 25 lines implementing `PipeTransform`, and Zod 4 ships `z.toJSONSchema()` natively for the OpenAPI side. Say in your report which path you took.

Update `apps/api/src/main.ts`:

```ts
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { Logger } from 'nestjs-pino';
import { ZodValidationPipe } from 'nestjs-zod';
import { AppModule } from './app.module';
import { setupOpenApi } from './common/openapi';
import { ProblemExceptionFilter } from './common/problem/problem.filter';
import type { Env } from './config/env.schema';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const logger = app.get(Logger);

  app.useLogger(logger);
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(new ZodValidationPipe());
  app.useGlobalFilters(new ProblemExceptionFilter(logger));
  app.enableShutdownHooks();

  setupOpenApi(app);

  const config = app.get(ConfigService<Env, true>);
  await app.listen(config.get('PORT', { infer: true }));
}

void bootstrap();
```

- [ ] **Step 9: Run the integration test to verify it passes**

Run: `pnpm --filter @majlis/api test:integration test/problem.integration.test.ts`
Expected: PASS — 3 tests.

- [ ] **Step 10: Verify the OpenAPI document is served**

Run `pnpm --filter @majlis/api start:dev`, then `curl -s http://localhost:3001/api/v1/docs-json | head -c 300`
Expected: JSON beginning `{"openapi":"3.0.0","info":{"title":"Majlis API"...`. Stop the server.

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "feat(api): RFC 9457 problem details, Zod pipe and generated OpenAPI

Prisma P2002 maps to 409 rather than 500 — a lost race under concurrency
is an expected outcome, not a server fault.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 13: Idempotent seed script

**Files:**
- Create: `apps/api/prisma/seed.ts`
- Test: `apps/api/test/seed.integration.test.ts`

**Interfaces:**
- Consumes: every model from Tasks 5–9.
- Produces: `seed(prisma: PrismaClient): Promise<void>`, exported so the test can call it directly, plus a CLI entry point for `pnpm db:seed`.
- Seeded accounts every later stage's manual testing relies on, all with password `Passw0rd!` (development only): `admin@uni.ac.ae` (ADMIN), `lead@uni.ac.ae`, `ops@uni.ac.ae`, `student@uni.ac.ae`.

- [ ] **Step 1: Write the failing test**

`apps/api/test/seed.integration.test.ts`:

```ts
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { seed } from '../prisma/seed';
import { createTestPrisma, disconnectTestPrisma, truncateAll } from './db';

const prisma = createTestPrisma();

afterAll(async () => { await disconnectTestPrisma(prisma); });
beforeEach(async () => { await truncateAll(prisma); });

describe('seed', () => {
  it('creates the four demo personas', async () => {
    await seed(prisma);
    const emails = (await prisma.user.findMany({ select: { email: true }, orderBy: { email: 'asc' } }))
      .map((u) => u.email);
    expect(emails).toEqual(['admin@uni.ac.ae', 'lead@uni.ac.ae', 'ops@uni.ac.ae', 'student@uni.ac.ae']);
  });

  it('makes exactly one Admin', async () => {
    await seed(prisma);
    expect(await prisma.user.count({ where: { platformRole: 'ADMIN' } })).toBe(1);
  });

  it('creates an active club with an active Lead and an active Operations officer', async () => {
    await seed(prisma);
    const club = await prisma.club.findFirstOrThrow();
    expect(club.status).toBe('ACTIVE');
    expect(await prisma.clubTeamAppointment.count({ where: { clubId: club.id, role: 'LEAD', status: 'ACTIVE' } })).toBe(1);
    expect(await prisma.clubTeamAppointment.count({ where: { clubId: club.id, role: 'OPERATIONS', status: 'ACTIVE' } })).toBe(1);
  });

  it('gives every user a QR pass', async () => {
    await seed(prisma);
    expect(await prisma.qrPass.count()).toBe(await prisma.user.count());
  });

  it('is idempotent — running it twice changes nothing', async () => {
    await seed(prisma);
    const after1 = {
      users: await prisma.user.count(),
      clubs: await prisma.club.count(),
      events: await prisma.event.count(),
      appointments: await prisma.clubTeamAppointment.count(),
      passes: await prisma.qrPass.count(),
    };

    await seed(prisma);
    const after2 = {
      users: await prisma.user.count(),
      clubs: await prisma.club.count(),
      events: await prisma.event.count(),
      appointments: await prisma.clubTeamAppointment.count(),
      passes: await prisma.qrPass.count(),
    };

    expect(after2).toEqual(after1);
  });

  it('never violates the one-active-Lead index on a re-run', async () => {
    await seed(prisma);
    await expect(seed(prisma)).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @majlis/api test:integration test/seed.integration.test.ts`
Expected: FAIL — cannot resolve `../prisma/seed`.

- [ ] **Step 3: Implement the seed**

`apps/api/prisma/seed.ts`:

```ts
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';

/**
 * Development data. Idempotent by construction: every write is an upsert keyed
 * on a natural unique column, so re-running is a no-op rather than a
 * constraint violation. Prisma 7 no longer runs this automatically.
 */

// Development only. Real hashing arrives with auth in Stage 2.
const DEV_PASSWORD_HASH = '$argon2id$v=19$m=65536,t=3,p=4$DEVELOPMENT$SEED-ONLY-NOT-A-REAL-HASH';

const hours = (n: number) => new Date(Date.now() + n * 3_600_000);

export async function seed(prisma: PrismaClient): Promise<void> {
  const people = [
    { email: 'admin@uni.ac.ae', fullName: 'Amina Al Marri', platformRole: 'ADMIN' as const },
    { email: 'lead@uni.ac.ae', fullName: 'Yousef Rahman', platformRole: 'STUDENT' as const },
    { email: 'ops@uni.ac.ae', fullName: 'Sara Khalid', platformRole: 'STUDENT' as const },
    { email: 'student@uni.ac.ae', fullName: 'Layla Hassan', platformRole: 'STUDENT' as const },
  ];

  const users: Record<string, string> = {};
  for (const person of people) {
    const user = await prisma.user.upsert({
      where: { email: person.email },
      update: { fullName: person.fullName, platformRole: person.platformRole },
      create: { ...person, passwordHash: DEV_PASSWORD_HASH },
    });
    users[person.email] = user.id;

    await prisma.qrPass.upsert({
      where: { userId: user.id },
      update: {},
      create: { userId: user.id },
    });
  }

  const department = await prisma.department.upsert({
    where: { code: 'ENG' },
    update: { name: 'Engineering' },
    create: { code: 'ENG', name: 'Engineering', description: 'Engineering faculty.' },
  });

  const club = await prisma.club.upsert({
    where: { slug: 'robotics-club' },
    update: {},
    create: {
      departmentId: department.id,
      name: 'Robotics Club',
      slug: 'robotics-club',
      description: 'Building and competing with autonomous robots.',
      category: 'Technology',
      academicYear: '2026/2027',
      logoUrl: 'https://placehold.co/512x512/png?text=RC',
      membershipPolicy: 'APPROVAL_REQUIRED',
    },
  });

  // Appointments have no natural unique key, so idempotency is a guarded
  // create rather than an upsert. The one-active-Lead partial index would
  // otherwise reject the second run.
  for (const [email, role] of [
    ['lead@uni.ac.ae', 'LEAD'],
    ['ops@uni.ac.ae', 'OPERATIONS'],
  ] as const) {
    const existing = await prisma.clubTeamAppointment.findFirst({
      where: { clubId: club.id, userId: users[email], role, status: 'ACTIVE' },
    });
    if (!existing) {
      await prisma.clubTeamAppointment.create({
        data: {
          clubId: club.id,
          userId: users[email]!,
          role,
          status: 'ACTIVE',
          invitedById: users['admin@uni.ac.ae']!,
          acceptedAt: new Date(),
        },
      });
    }

    // Team members hold an ordinary membership too, kept as a separate record.
    const membership = await prisma.clubMembership.findFirst({
      where: { clubId: club.id, userId: users[email], status: 'ACTIVE' },
    });
    if (!membership) {
      await prisma.clubMembership.create({
        data: { clubId: club.id, userId: users[email]!, status: 'ACTIVE', decidedAt: new Date() },
      });
    }
  }

  await prisma.event.upsert({
    where: { clubId_slug: { clubId: club.id, slug: 'intro-to-ros' } },
    update: {},
    create: {
      clubId: club.id,
      title: 'Introduction to ROS 2',
      slug: 'intro-to-ros',
      summary: 'A hands-on first session with the Robot Operating System.',
      description: 'Bring a laptop. No prior robotics experience required.',
      eventType: 'WORKSHOP',
      audience: 'ALL_STUDENTS',
      venue: 'Engineering Building, Lab 2.14',
      startsAt: hours(48),
      endsAt: hours(51),
      registrationOpensAt: hours(-24),
      registrationClosesAt: hours(46),
      checkInOpensAt: hours(47),
      checkInClosesAt: hours(51.5),
      capacity: 30,
      waitlistEnabled: true,
      certificateEnabled: true,
      certificateTitle: 'Certificate of Attendance — Introduction to ROS 2',
      status: 'PUBLISHED',
      createdById: users['lead@uni.ac.ae']!,
    },
  });
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set.');

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  try {
    await seed(prisma);
    console.error('Seed complete.');
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  void main();
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @majlis/api test:integration test/seed.integration.test.ts`
Expected: PASS — 6 tests.

- [ ] **Step 5: Run the seed against the development database**

Run: `pnpm --filter @majlis/api db:seed`
Expected: prints `Seed complete.` Run it a second time — it must succeed again with no error.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(api): idempotent development seed

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 14: Continuous integration

**Files:**
- Create: `.github/workflows/ci.yml`
- Create: `README.md`

**Interfaces:**
- Consumes: every workspace script defined in Tasks 1–13.
- Produces: a CI pipeline running typecheck → lint → unit → integration → build against a `postgres:18` service container.

- [ ] **Step 1: Write the CI workflow**

`.github/workflows/ci.yml`:

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

env:
  # Integration tests refuse to run against anything not named majlis_test.
  TEST_DATABASE_URL: postgresql://majlis:majlis@localhost:5432/majlis_test?schema=public
  DATABASE_URL: postgresql://majlis:majlis@localhost:5432/majlis_test?schema=public
  DIRECT_URL: postgresql://majlis:majlis@localhost:5432/majlis_test?schema=public

jobs:
  verify:
    runs-on: ubuntu-latest

    services:
      postgres:
        image: postgres:18
        env:
          POSTGRES_USER: majlis
          POSTGRES_PASSWORD: majlis
          POSTGRES_DB: majlis_test
        ports: ['5432:5432']
        options: >-
          --health-cmd "pg_isready -U majlis"
          --health-interval 10s
          --health-timeout 5s
          --health-retries 10

    steps:
      - uses: actions/checkout@v5

      - uses: pnpm/action-setup@v4
        with:
          version: 11.15.0

      - uses: actions/setup-node@v5
        with:
          node-version-file: .nvmrc
          cache: pnpm

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Generate Prisma client
        run: pnpm --filter @majlis/api prisma:generate

      - name: Typecheck
        run: pnpm typecheck

      - name: Lint
        run: pnpm lint

      - name: Unit tests
        run: pnpm test

      - name: Integration tests
        run: pnpm --filter @majlis/api test:integration
        env:
          # No .env file in CI; dotenv-cli must not fail on its absence.
          DOTENV_CONFIG_PATH: ''

      - name: Build
        run: pnpm build
```

> There is no `.env` in CI. The `test:integration` script already uses `dotenv-cli`'s `-c` flag (Task 4), which tolerates a missing file, so the workflow's `env:` block supplies the values instead. If the integration step fails with a missing-`.env` error, that flag was dropped — restore it rather than deleting the `dotenv` wrapper, which local runs depend on.

- [ ] **Step 2: Write the README**

`README.md`:

````markdown
# Majlis

University club and event management. One verified student identity, one club
structure, one registration record, one attendance truth, one certificate history.

## Stack

NestJS 12 · Prisma 7 · PostgreSQL 18 (Supabase in production) · Next.js 16 ·
Tailwind v4 + shadcn/ui · Zod 4 shared contracts · pnpm + Turborepo

## Getting started

Prerequisites: Node 22.14, pnpm 11.15, PostgreSQL 18 on `localhost:5432`.

```bash
pnpm install
cp .env.example .env

# One-time database bootstrap
psql -U postgres -h localhost -f scripts/bootstrap-db.sql
psql -U postgres -h localhost -c "CREATE DATABASE majlis_dev OWNER majlis;"
psql -U postgres -h localhost -c "CREATE DATABASE majlis_test OWNER majlis;"

pnpm --filter @majlis/api prisma:generate
pnpm --filter @majlis/api prisma:deploy
pnpm --filter @majlis/api db:seed
pnpm --filter @majlis/api start:dev
```

The API is then on <http://localhost:3001/api/v1>, with generated OpenAPI docs
at <http://localhost:3001/api/v1/docs>.

## Commands

| Command | What it does |
| --- | --- |
| `pnpm typecheck` | Typecheck every package |
| `pnpm lint` | Lint every package |
| `pnpm test` | Unit tests |
| `pnpm --filter @majlis/api test:integration` | Integration tests against `majlis_test` |
| `pnpm build` | Build every package |

## Seeded accounts

Development only. Password `Passw0rd!` once auth lands in Stage 2.

| Email | Role |
| --- | --- |
| `admin@uni.ac.ae` | Platform Admin |
| `lead@uni.ac.ae` | Club Lead of Robotics Club |
| `ops@uni.ac.ae` | Operations Officer of Robotics Club |
| `student@uni.ac.ae` | Student |

## Documentation

- Design spec: [`docs/specs/2026-09-10-majlis-design.md`](docs/specs/2026-09-10-majlis-design.md)
- Plans: [`docs/superpowers/plans/`](docs/superpowers/plans/)
````

- [ ] **Step 3: Verify the whole pipeline locally before pushing**

Run, in order:

```bash
pnpm install --frozen-lockfile
pnpm --filter @majlis/api prisma:generate
pnpm typecheck
pnpm lint
pnpm test
pnpm --filter @majlis/api test:integration
pnpm build
```

Expected: every command exits 0. Do not proceed until all seven pass.

- [ ] **Step 4: Create the GitHub repository**

The repository was created locally with `git init` and has no remote yet. `gh` is installed and authenticated.

```bash
git remote -v
```

If that prints nothing, create the remote (ask the user first whether it should be private or public — this publishes the code):

```bash
gh repo create majlis --private --source=. --remote=origin
```

- [ ] **Step 5: Commit and push, then confirm CI is green**

```bash
git add -A
git commit -m "ci: typecheck, lint, unit, integration and build on postgres 18

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
git push -u origin main
gh run watch
```

Expected: the `verify` job passes. If it fails, fix the cause — do not disable a step.

---

## Stage 1 done when

- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build` all pass
- [ ] `pnpm --filter @majlis/api test:integration` passes — every schema constraint is proven by a test that fails without it
- [ ] `pnpm --filter @majlis/api db:seed` runs twice with no error
- [ ] `GET /api/v1/health` returns `{ status: 'ok', database: 'up' }`
- [ ] `GET /api/v1/docs` serves the generated OpenAPI document
- [ ] CI is green on `main`
- [ ] The spec's Stage 1 row in §13 is ticked, with any deviation recorded in the spec itself
