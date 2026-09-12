# Stage 4: Clubs, Team and Membership Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship departments, club CRUD with its status machine, a shared image upload pipeline, Lead appointment, in-app team invitations, the four membership policies, and every screen these features need across all three shells.

**Architecture:** Eight API tasks then four web tasks. The API follows the `users` module pattern exactly: a Zod contract in `packages/contracts`, a thin controller carrying `@RequirePermission`, and a service that writes through `TransactionHost` and throws `DomainError` subclasses. Images are converted to WebP in the browser and PUT straight to Supabase Storage through a short-lived signed URL; the API never handles image bytes, and verifies the uploaded object before it stores a URL.

**Tech Stack:** NestJS 12, Prisma 7, PostgreSQL 18, Zod 4, Next.js 16 App Router, Tailwind v4, shadcn/ui, Supabase Storage. No new runtime dependency is added in this stage.

**Spec:** [`docs/specs/2026-09-12-stage-4-clubs-team-membership-design.md`](../../specs/2026-09-12-stage-4-clubs-team-membership-design.md), which is subordinate to [`docs/specs/2026-09-10-majlis-design.md`](../../specs/2026-09-10-majlis-design.md).

## Global Constraints

- **Never read `../majlis`.** That is the abandoned previous build.
- **No em dashes.** Not in code, comments, commit messages, documentation, or UI copy.
- **No explanatory UI copy.** No taglines, helper text, or empty-state explainers. `EmptyState` and `Field` have no `description` prop and none is added.
- **Services throw `DomainError` subclasses** (`NotFoundError`, `ForbiddenError`, `ConflictError`, `UnprocessableError`) from `src/common/problem/domain-error.ts`, never `@nestjs/common` exceptions.
- **Write through `TransactionHost`, never `PrismaService`.** `host.tx` is the ambient transaction; `host.run(fn)` opens one or joins the caller's. An ESLint rule enforces this and `src/prisma/boundary.spec.ts` tests the rule.
- **Audit every sensitive action in the same transaction as the action.** Use `AuditService.record`, which writes through `host.tx`.
- **Every state transition goes through the entity's transition function.** No ad hoc `status` writes.
- **Cursor pagination on every list endpoint.** Use `cursorPageQuerySchema` and `cursorPageSchema` from `@majlis/contracts`. No unbounded list anywhere.
- **Use the `API_PREFIX` constant** from `src/config/api-prefix.ts`. Its leading slash is load-bearing.
- **Server-side authorization on every protected endpoint.** Re-derive from the database per request. Never trust a client-supplied role, club id, or ownership claim.
- **No secrets in code or logs.** `SUPABASE_SERVICE_ROLE_KEY` never leaves the API process.
- **Tests must discriminate.** Before trusting a test, name the broken implementation it would catch. If you cannot, it is not testing anything.
- **Zod 4 traps:** `.url()` does not restrict the scheme and accepts `javascript:` and `data:text/html`. `z.email().trim()` validates before trimming; use `z.string().trim().email()`.
- **Prisma raises `P2007`, not `P2023`,** for a malformed UUID with `@prisma/adapter-pg`.
- **Throwing inside `host.run()` rolls back everything, including the audit row.** Return a result and throw after the commit when a write must survive.
- **Motion tokens only** (`--dur`, `--dur-fast`, `--ease-out`). Never hardcode a duration, never write your own `prefers-reduced-motion` query.
- **`--color-border-control` is the only border token a form control may use.** It is held to 3:1 for WCAG SC 1.4.11.
- **If axe reports a violation, fix the markup.** Never narrow the tag list, add exclusions, or scope the scan.
- **A Server Component cannot pass a component reference to a Client Component.** Pass a `ReactNode`, not a `ComponentType`. This fails at render time only, invisible to build, typecheck and lint.
- **No new dependency may have been published in the last 48 hours.** pnpm 11 refuses anything under 24 hours old.

## Route parameter naming

`PermissionsGuard` reads the scope identifier from a dotted path on the Express request, configured per handler. Every club-scoped route in this stage uses the parameter name **`clubId`**, and every `@RequirePermission` with club scope passes `{ scope: 'club', from: 'params.clubId' }`. A handler that names the parameter `id` while the decorator reads `params.clubId` resolves no scope, which the guard treats as a denial, so a real Lead is refused with no type error and no failing unit test.

## Deviation D5, recorded here and in the spec at review time

Spec §9 lists `DELETE /appointments/{id}` and `PATCH /membership-requests/{id}` as flat paths. Both are club-scoped permissions, and the guard can only read a scope identifier off the request, never look one up from a row. Both are therefore nested under their club:

- `DELETE /clubs/:clubId/team/:appointmentId`
- `PATCH /clubs/:clubId/membership-requests/:requestId`

Each handler must additionally verify the nested row actually belongs to `clubId`. Without that check, the Lead of club A passes club A's id with club B's appointment id and acts on another club's team. Task 6 and Task 8 each carry a test for exactly this.

`POST /appointments/:appointmentId/accept` and `/decline` stay flat because they are self-scoped: they carry no `@RequirePermission` and the service checks `actor.id === appointment.userId`.

---

## File structure

**Contracts** (`packages/contracts/src/`)

| File | Responsibility |
|---|---|
| `departments/index.ts` + `index.test.ts` | Department schemas and types |
| `clubs/index.ts` + `index.test.ts` | Club schemas, status enum, policy enum, upload kinds |
| `team/index.ts` + `index.test.ts` | Appointment schemas, club role enum |
| `membership/index.ts` + `index.test.ts` | Membership schemas, status enum |

**API** (`apps/api/src/`)

| File | Responsibility |
|---|---|
| `storage/image-kinds.ts` + `.spec.ts` | The per-kind box, cap and path builder. Pure data and pure functions. |
| `storage/storage.service.ts` + `.spec.ts` | Two Supabase REST calls: sign an upload URL, stat an object |
| `storage/storage.module.ts` | Exports `StorageService` |
| `departments/departments.{module,controller,service}.ts` | Department CRUD |
| `clubs/slug.ts` + `.spec.ts` | Slug derivation and collision suffixing |
| `clubs/club-status.ts` + `.spec.ts` | The status transition function and the activity gates |
| `clubs/clubs.{module,controller,service}.ts` | Club CRUD, upload URLs, status, Lead appointment |
| `clubs/team/team.{controller,service}.ts` | Appointments: invite, end, accept, decline, list |
| `clubs/membership/membership.{controller,service}.ts` | Requests, decisions, add, remove, leave, lists |

**Web** (`apps/web/src/`)

| File | Responsibility |
|---|---|
| `lib/image.ts` + `.test.ts` | Browser-side resize and WebP encode |
| `lib/clubs.ts` | Typed fetch wrappers over the new endpoints |
| `components/ImageUpload.tsx` | Convert, request a signed URL, PUT, report progress and refusals |
| `components/ui/{select,textarea,dialog,table}.tsx` | shadcn additions re-pointed at our tokens |
| `app/(admin)/admin/departments/page.tsx` | Department management |
| `app/(admin)/admin/clubs/page.tsx`, `clubs/new/page.tsx`, `clubs/[clubId]/page.tsx` | Club list, creation, detail with status and Lead |
| `app/(club)/manage/[clubId]/overview/page.tsx` | Profile edit, images, policy |
| `app/(club)/manage/[clubId]/team/page.tsx` | Team list, invite, end |
| `app/(club)/manage/[clubId]/members/page.tsx` | Requests queue and member list |
| `app/(student)/clubs/page.tsx`, `clubs/[slug]/page.tsx` | Browse and club detail with joining |
| `app/(student)/me/page.tsx` | My clubs, my invitations, leaving |

---

## Task 1: Contracts and permission rows

**Files:**
- Create: `packages/contracts/src/departments/index.ts`, `packages/contracts/src/departments/index.test.ts`
- Create: `packages/contracts/src/clubs/index.ts`, `packages/contracts/src/clubs/index.test.ts`
- Create: `packages/contracts/src/team/index.ts`, `packages/contracts/src/team/index.test.ts`
- Create: `packages/contracts/src/membership/index.ts`, `packages/contracts/src/membership/index.test.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `apps/api/src/auth/permissions.ts`
- Test: `apps/api/src/auth/permissions.spec.ts`

**Interfaces:**
- Consumes: `cursorPageSchema`, `cursorPageQuerySchema` from `packages/contracts/src/common/pagination.ts`.
- Produces: every schema and type below. Tasks 3 through 12 import them from `@majlis/contracts`.

- [ ] **Step 1: Write the failing contract tests**

`packages/contracts/src/clubs/index.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { academicYearSchema, createClubBodySchema, patchClubStatusBodySchema } from './index';

describe('academicYearSchema', () => {
  it('rejects a year pair that is not consecutive', () => {
    // Catches /^\d{4}\/\d{4}$/ alone, which accepts 2026/2030 and 2026/2020.
    expect(academicYearSchema.safeParse('2026/2030').success).toBe(false);
    expect(academicYearSchema.safeParse('2026/2025').success).toBe(false);
  });

  it('accepts a consecutive pair', () => {
    expect(academicYearSchema.safeParse('2026/2027').success).toBe(true);
  });

  it('rejects a shape that is not four digits, slash, four digits', () => {
    expect(academicYearSchema.safeParse('26/27').success).toBe(false);
    expect(academicYearSchema.safeParse('2026-2027').success).toBe(false);
  });
});

describe('patchClubStatusBodySchema', () => {
  it('rejects a body with no reason', () => {
    // Every admin override carries a recorded reason (main spec 6.1).
    expect(patchClubStatusBodySchema.safeParse({ status: 'SUSPENDED' }).success).toBe(false);
  });

  it('rejects a whitespace-only reason', () => {
    expect(
      patchClubStatusBodySchema.safeParse({ status: 'SUSPENDED', reason: '   ' }).success,
    ).toBe(false);
  });

  it('rejects a status outside the three real values', () => {
    expect(
      patchClubStatusBodySchema.safeParse({ status: 'DELETED', reason: 'x' }).success,
    ).toBe(false);
  });
});

describe('createClubBodySchema', () => {
  it('rejects a logoUrl on a javascript: scheme', () => {
    // Zod 4's .url() validates shape only, not scheme. A stored
    // javascript: URL is echoed into every viewer's browser.
    const body = {
      clubId: '01936c7e-0000-7000-8000-000000000000',
      departmentId: '01936c7e-0000-7000-8000-000000000001',
      name: 'Robotics',
      description: 'We build robots.',
      category: 'Technology',
      academicYear: '2026/2027',
      membershipPolicy: 'OPEN',
      logoUrl: 'javascript:alert(1)',
    };
    expect(createClubBodySchema.safeParse(body).success).toBe(false);
  });

  it('rejects a clubId that is not a UUID', () => {
    // The server minted this id and the client echoes it back. A
    // non-UUID reaches Prisma and raises P2007 rather than a clean 400.
    const body = {
      clubId: 'not-a-uuid',
      departmentId: '01936c7e-0000-7000-8000-000000000001',
      name: 'Robotics',
      description: 'We build robots.',
      category: 'Technology',
      academicYear: '2026/2027',
      membershipPolicy: 'OPEN',
      logoUrl: 'https://example.supabase.co/storage/v1/object/public/majlis-storage/clubs/x/logo.webp',
    };
    expect(createClubBodySchema.safeParse(body).success).toBe(false);
  });
});
```

`packages/contracts/src/membership/index.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { decideMembershipBodySchema } from './index';

describe('decideMembershipBodySchema', () => {
  it('rejects PENDING as a decision target', () => {
    // Catches `status: membershipStatusSchema`, which lets a decision
    // handler write PENDING, LEFT or REMOVED through the decide route and
    // bypass the transitions those values are supposed to go through.
    expect(decideMembershipBodySchema.safeParse({ status: 'PENDING' }).success).toBe(false);
  });

  it('rejects LEFT and REMOVED as decision targets', () => {
    expect(decideMembershipBodySchema.safeParse({ status: 'LEFT' }).success).toBe(false);
    expect(decideMembershipBodySchema.safeParse({ status: 'REMOVED' }).success).toBe(false);
  });

  it('accepts ACTIVE and REJECTED', () => {
    expect(decideMembershipBodySchema.safeParse({ status: 'ACTIVE' }).success).toBe(true);
    expect(decideMembershipBodySchema.safeParse({ status: 'REJECTED' }).success).toBe(true);
  });
});
```

`packages/contracts/src/team/index.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { inviteTeamMemberBodySchema } from './index';

describe('inviteTeamMemberBodySchema', () => {
  it('rejects LEAD, which has its own Admin-only route', () => {
    // Catches `role: clubRoleSchema`. A Lead could otherwise invite a
    // second Lead through the team route, which spec 6.1 reserves to Admin.
    const body = { userId: '01936c7e-0000-7000-8000-000000000000', role: 'LEAD' };
    expect(inviteTeamMemberBodySchema.safeParse(body).success).toBe(false);
  });

  it('accepts the four non-Lead roles', () => {
    for (const role of ['VICE_LEAD', 'MARKETING', 'CTO', 'OPERATIONS']) {
      const body = { userId: '01936c7e-0000-7000-8000-000000000000', role };
      expect(inviteTeamMemberBodySchema.safeParse(body).success).toBe(true);
    }
  });
});
```

`packages/contracts/src/departments/index.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createDepartmentBodySchema } from './index';

describe('createDepartmentBodySchema', () => {
  it('rejects a lowercase code', () => {
    // The column is compared case-sensitively for uniqueness, so "cs" and
    // "CS" would both be storable and neither would collide.
    expect(createDepartmentBodySchema.safeParse({ name: 'Computer Science', code: 'cs' }).success).toBe(false);
  });

  it('rejects a code with punctuation', () => {
    expect(createDepartmentBodySchema.safeParse({ name: 'Computer Science', code: 'C-S' }).success).toBe(false);
  });

  it('accepts an uppercase alphanumeric code', () => {
    expect(createDepartmentBodySchema.safeParse({ name: 'Computer Science', code: 'CS01' }).success).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @majlis/contracts test`
Expected: FAIL, cannot resolve `./index` for all four new directories.

- [ ] **Step 3: Write the department contract**

`packages/contracts/src/departments/index.ts`:

```ts
import { z } from 'zod';
import { cursorPageSchema } from '../common/pagination';

export const createDepartmentBodySchema = z.object({
  name: z.string().trim().min(2).max(120),
  code: z.string().trim().regex(/^[A-Z0-9]{2,10}$/, 'must be 2 to 10 uppercase letters or digits'),
  description: z.string().trim().max(500).optional(),
});

export const patchDepartmentBodySchema = createDepartmentBodySchema.partial();

export const departmentSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  code: z.string(),
  description: z.string().nullable(),
  clubCount: z.number().int().nonnegative(),
});

export const departmentPageSchema = cursorPageSchema(departmentSchema);

export type CreateDepartmentBody = z.infer<typeof createDepartmentBodySchema>;
export type PatchDepartmentBody = z.infer<typeof patchDepartmentBodySchema>;
export type Department = z.infer<typeof departmentSchema>;
export type DepartmentPage = z.infer<typeof departmentPageSchema>;
```

- [ ] **Step 4: Write the club contract**

`packages/contracts/src/clubs/index.ts`:

```ts
import { z } from 'zod';
import { cursorPageQuerySchema, cursorPageSchema } from '../common/pagination';

export const clubStatusSchema = z.enum(['ACTIVE', 'SUSPENDED', 'ARCHIVED']);
export const membershipPolicySchema = z.enum(['OPEN', 'APPROVAL_REQUIRED', 'INVITE_ONLY', 'CLOSED']);

/**
 * Zod 4's .url() checks shape, not scheme. Every stored URL in this product
 * is rendered into a browser, so the scheme is allowlisted explicitly.
 */
export const httpsUrlSchema = z
  .string()
  .trim()
  .max(2048)
  .refine((v) => {
    try {
      return new URL(v).protocol === 'https:';
    } catch {
      return false;
    }
  }, 'must be an https URL');

export const academicYearSchema = z
  .string()
  .trim()
  .regex(/^\d{4}\/\d{4}$/, 'must look like 2026/2027')
  .refine((v) => {
    const [from, to] = v.split('/').map(Number) as [number, number];
    return to === from + 1;
  }, 'must be two consecutive years');

export const createClubBodySchema = z.object({
  clubId: z.uuid(),
  departmentId: z.uuid(),
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().min(1).max(2000),
  category: z.string().trim().min(2).max(60),
  academicYear: academicYearSchema,
  membershipPolicy: membershipPolicySchema,
  logoUrl: httpsUrlSchema,
});

export const patchClubBodySchema = z
  .object({
    departmentId: z.uuid(),
    description: z.string().trim().min(1).max(2000),
    category: z.string().trim().min(2).max(60),
    academicYear: academicYearSchema,
    membershipPolicy: membershipPolicySchema,
    logoUrl: httpsUrlSchema,
    bannerUrl: httpsUrlSchema.nullable(),
  })
  .partial();

export const patchClubStatusBodySchema = z.object({
  status: clubStatusSchema,
  reason: z.string().trim().min(1).max(500),
});

export const appointLeadBodySchema = z.object({ userId: z.uuid() });

/** The kinds an upload URL may be requested for. Mirrors IMAGE_KINDS in the API. */
export const imageKindSchema = z.enum(['club-logo', 'club-banner']);

export const signedUploadSchema = z.object({
  path: z.string(),
  signedUrl: z.url(),
  token: z.string(),
  /** The URL to store once the upload succeeds, version suffix included. */
  publicUrl: httpsUrlSchema,
});

/** POST /uploads/club-logo also mints the id the club will be created with. */
export const newClubUploadSchema = signedUploadSchema.extend({ clubId: z.uuid() });

export const clubSummarySchema = z.object({
  id: z.uuid(),
  slug: z.string(),
  name: z.string(),
  category: z.string(),
  logoUrl: z.string(),
  status: clubStatusSchema,
  membershipPolicy: membershipPolicySchema,
  departmentName: z.string(),
  memberCount: z.number().int().nonnegative(),
});

export const clubDetailSchema = clubSummarySchema.extend({
  description: z.string(),
  academicYear: z.string(),
  bannerUrl: z.string().nullable(),
  departmentId: z.uuid(),
  /** The viewer's own relationship to this club. Never another user's. */
  viewerMembershipStatus: z
    .enum(['PENDING', 'ACTIVE', 'REJECTED', 'LEFT', 'REMOVED'])
    .nullable(),
  viewerClubRoles: z.array(z.enum(['LEAD', 'VICE_LEAD', 'MARKETING', 'CTO', 'OPERATIONS'])),
});

export const clubPageSchema = cursorPageSchema(clubSummarySchema);

export const clubListQuerySchema = cursorPageQuerySchema.extend({
  departmentId: z.uuid().optional(),
  status: clubStatusSchema.optional(),
  q: z.string().trim().min(1).max(120).optional(),
});

export type ClubStatus = z.infer<typeof clubStatusSchema>;
export type MembershipPolicy = z.infer<typeof membershipPolicySchema>;
export type CreateClubBody = z.infer<typeof createClubBodySchema>;
export type PatchClubBody = z.infer<typeof patchClubBodySchema>;
export type PatchClubStatusBody = z.infer<typeof patchClubStatusBodySchema>;
export type AppointLeadBody = z.infer<typeof appointLeadBodySchema>;
export type ImageKind = z.infer<typeof imageKindSchema>;
export type SignedUpload = z.infer<typeof signedUploadSchema>;
export type NewClubUpload = z.infer<typeof newClubUploadSchema>;
export type ClubSummary = z.infer<typeof clubSummarySchema>;
export type ClubDetail = z.infer<typeof clubDetailSchema>;
export type ClubPage = z.infer<typeof clubPageSchema>;
export type ClubListQuery = z.infer<typeof clubListQuerySchema>;
```

- [ ] **Step 5: Write the team contract**

`packages/contracts/src/team/index.ts`:

```ts
import { z } from 'zod';
import { cursorPageSchema } from '../common/pagination';

export const clubRoleSchema = z.enum(['LEAD', 'VICE_LEAD', 'MARKETING', 'CTO', 'OPERATIONS']);
export const appointmentStatusSchema = z.enum(['INVITED', 'ACTIVE', 'DECLINED', 'EXPIRED', 'ENDED']);

/**
 * LEAD is excluded. Appointing a Lead is Admin-only and has its own route
 * (POST /clubs/:clubId/lead), so admitting LEAD here would let a Lead
 * appoint a co-Lead through a route only Lead permission guards.
 */
export const inviteTeamMemberBodySchema = z.object({
  userId: z.uuid(),
  role: z.enum(['VICE_LEAD', 'MARKETING', 'CTO', 'OPERATIONS']),
});

export const endAppointmentBodySchema = z.object({
  reason: z.string().trim().min(1).max(500),
});

export const appointmentSchema = z.object({
  id: z.uuid(),
  clubId: z.uuid(),
  userId: z.uuid(),
  userFullName: z.string(),
  userEmail: z.string(),
  role: clubRoleSchema,
  status: appointmentStatusSchema,
  invitationExpiresAt: z.string().nullable(),
  acceptedAt: z.string().nullable(),
  endedAt: z.string().nullable(),
  /** True when this officer is no longer an ordinary member of the club. */
  hasLeftClub: z.boolean(),
});

export const invitationSchema = z.object({
  id: z.uuid(),
  clubId: z.uuid(),
  clubName: z.string(),
  clubLogoUrl: z.string(),
  role: clubRoleSchema,
  invitationExpiresAt: z.string(),
});

export const appointmentPageSchema = cursorPageSchema(appointmentSchema);

export type ClubRole = z.infer<typeof clubRoleSchema>;
export type AppointmentStatus = z.infer<typeof appointmentStatusSchema>;
export type InviteTeamMemberBody = z.infer<typeof inviteTeamMemberBodySchema>;
export type EndAppointmentBody = z.infer<typeof endAppointmentBodySchema>;
export type Appointment = z.infer<typeof appointmentSchema>;
export type Invitation = z.infer<typeof invitationSchema>;
export type AppointmentPage = z.infer<typeof appointmentPageSchema>;
```

- [ ] **Step 6: Write the membership contract**

`packages/contracts/src/membership/index.ts`:

```ts
import { z } from 'zod';
import { cursorPageQuerySchema, cursorPageSchema } from '../common/pagination';

export const membershipStatusSchema = z.enum(['PENDING', 'ACTIVE', 'REJECTED', 'LEFT', 'REMOVED']);

/**
 * Only two values are reachable through the decide route. PENDING is the
 * starting state, and LEFT and REMOVED have their own routes with their own
 * permissions, so admitting them here would route a removal through the
 * approval handler and skip its audit action.
 */
export const decideMembershipBodySchema = z.object({
  status: z.enum(['ACTIVE', 'REJECTED']),
  reason: z.string().trim().min(1).max(500).optional(),
});

export const addMemberBodySchema = z.object({ userId: z.uuid() });

export const memberSchema = z.object({
  id: z.uuid(),
  userId: z.uuid(),
  userFullName: z.string(),
  userEmail: z.string(),
  status: membershipStatusSchema,
  requestedAt: z.string(),
  decidedAt: z.string().nullable(),
  clubRoles: z.array(z.enum(['LEAD', 'VICE_LEAD', 'MARKETING', 'CTO', 'OPERATIONS'])),
});

export const memberPageSchema = cursorPageSchema(memberSchema);

export const memberListQuerySchema = cursorPageQuerySchema.extend({
  status: membershipStatusSchema.optional(),
});

export const myClubSchema = z.object({
  clubId: z.uuid(),
  slug: z.string(),
  name: z.string(),
  logoUrl: z.string(),
  status: membershipStatusSchema,
  clubRoles: z.array(z.enum(['LEAD', 'VICE_LEAD', 'MARKETING', 'CTO', 'OPERATIONS'])),
});

export const myClubPageSchema = cursorPageSchema(myClubSchema);

export type MembershipStatus = z.infer<typeof membershipStatusSchema>;
export type DecideMembershipBody = z.infer<typeof decideMembershipBodySchema>;
export type AddMemberBody = z.infer<typeof addMemberBodySchema>;
export type Member = z.infer<typeof memberSchema>;
export type MemberPage = z.infer<typeof memberPageSchema>;
export type MemberListQuery = z.infer<typeof memberListQuerySchema>;
export type MyClub = z.infer<typeof myClubSchema>;
export type MyClubPage = z.infer<typeof myClubPageSchema>;
```

- [ ] **Step 7: Export the new modules**

Append to `packages/contracts/src/index.ts`:

```ts
export * from './departments';
export * from './clubs';
export * from './team';
export * from './membership';
```

- [ ] **Step 8: Run the contract tests to verify they pass**

Run: `pnpm --filter @majlis/contracts test`
Expected: PASS, all four new test files green.

- [ ] **Step 9: Write the failing permission test**

Append to `apps/api/src/auth/permissions.spec.ts`:

```ts
describe('Stage 4 permission rows', () => {
  const student: ActorFacts = {
    userId: 'u1',
    platformRole: 'STUDENT',
    clubRoles: [],
    eventResponsibilities: [],
  };
  const asClub = (roles: ActorFacts['clubRoles']): ActorFacts => ({ ...student, clubRoles: roles });
  const admin: ActorFacts = { ...student, platformRole: 'ADMIN' };

  it('reserves club creation, status and Lead appointment to Admin', () => {
    for (const p of ['club:create', 'club:status', 'club:appoint-lead', 'department:manage'] as const) {
      expect(evaluate(p, admin)).toBe(true);
      // Catches a rule that listed `club: ['LEAD']` by copy and paste. A
      // Lead who can archive their own club or appoint their successor has
      // escaped the governance model entirely.
      expect(evaluate(p, asClub(['LEAD']))).toBe(false);
      expect(evaluate(p, student)).toBe(false);
    }
  });

  it('gives team management to Lead but not to Vice Lead', () => {
    // Catches `club: ['LEAD', 'VICE_LEAD']`, which spec 6.1 gives to
    // "Invite / end team appointments" for Lead only.
    expect(evaluate('club:team-manage', asClub(['LEAD']))).toBe(true);
    expect(evaluate('club:team-manage', asClub(['VICE_LEAD']))).toBe(false);
    expect(evaluate('club:team-manage', admin)).toBe(true);
  });

  it('gives membership decisions to Lead, Vice Lead and Operations only', () => {
    for (const role of ['LEAD', 'VICE_LEAD', 'OPERATIONS'] as const) {
      expect(evaluate('membership:decide', asClub([role]))).toBe(true);
    }
    // Catches a rule that admitted every club role. Marketing and CTO
    // deciding who joins is not in spec 6.1.
    expect(evaluate('membership:decide', asClub(['MARKETING']))).toBe(false);
    expect(evaluate('membership:decide', asClub(['CTO']))).toBe(false);
  });

  it('does not give Marketing or CTO club editing in this stage', () => {
    // Stage 4 deviation D4: field-level permissions land in Stage 5.
    expect(evaluate('club:edit', asClub(['MARKETING']))).toBe(false);
    expect(evaluate('club:edit', asClub(['CTO']))).toBe(false);
    expect(evaluate('club:edit', asClub(['VICE_LEAD']))).toBe(true);
  });
});
```

- [ ] **Step 10: Run it to verify it fails**

Run: `pnpm --filter @majlis/api test -- permissions`
Expected: FAIL, `evaluate` returns false for every new permission because no rule exists.

- [ ] **Step 11: Add the permission rows**

In `apps/api/src/auth/permissions.ts`, extend the `PERMISSIONS` object. Add rows only; do not touch `evaluate`, `matches`, or the guard.

```ts
export const PERMISSIONS = {
  'user:list': { platform: ['ADMIN'] },
  'user:suspend': { platform: ['ADMIN'] },
  'department:manage': { platform: ['ADMIN'] },
  'club:create': { platform: ['ADMIN'] },
  'club:status': { platform: ['ADMIN'] },
  'club:appoint-lead': { platform: ['ADMIN'] },
  'club:edit': { platform: ['ADMIN'], club: ['LEAD', 'VICE_LEAD'] },
  'club:team-manage': { platform: ['ADMIN'], club: ['LEAD'] },
  'membership:decide': { platform: ['ADMIN'], club: ['LEAD', 'VICE_LEAD', 'OPERATIONS'] },
} as const satisfies Record<string, PermissionRule>;
```

- [ ] **Step 12: Run the API unit tests**

Run: `pnpm --filter @majlis/api test`
Expected: PASS.

- [ ] **Step 13: Commit**

```bash
git add packages/contracts apps/api/src/auth/permissions.ts apps/api/src/auth/permissions.spec.ts
git commit -m "feat(contracts): Stage 4 schemas and permission rows"
```

---

## Task 2: Storage module, env, and log redaction

**Files:**
- Create: `apps/api/src/storage/image-kinds.ts`, `apps/api/src/storage/image-kinds.spec.ts`
- Create: `apps/api/src/storage/storage.service.ts`, `apps/api/src/storage/storage.service.spec.ts`
- Create: `apps/api/src/storage/storage.module.ts`
- Modify: `apps/api/src/config/env.schema.ts`, `apps/api/src/config/env.schema.spec.ts`
- Modify: `apps/api/src/config/log-redaction.ts`, `apps/api/src/config/log-redaction.spec.ts`
- Modify: `apps/api/src/app.module.ts`
- Modify: `.env.example`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `IMAGE_KINDS: Record<ImageKind, { maxBytes: number; box: { w: number; h: number }; square: boolean }>`
  - `objectPath(kind: ImageKind, resourceId: string): string`
  - `publicUrl(baseUrl: string, path: string, version: number): string`
  - `class StorageService { createSignedUploadUrl(path: string): Promise<{ signedUrl: string; token: string }>; statObject(path: string): Promise<{ size: number; contentType: string } | null>; publicUrlFor(path: string, version: number): string }`
  - `StorageModule`, exporting `StorageService`.

- [ ] **Step 1: Verify the Supabase wire format before writing any client code**

Do not write the HTTP client from memory. With the real credentials in `.env`, run both calls and record the exact request and response shapes in the task report.

```bash
set -a; . ./.env; set +a
BUCKET=majlis-storage
curl -s -X POST \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
  "$SUPABASE_STORAGE_URL/storage/v1/object/upload/sign/$BUCKET/clubs/probe/logo.webp"
```

Then upload a small WebP through the returned URL, and stat it:

```bash
curl -s -I "$SUPABASE_STORAGE_URL/storage/v1/object/public/$BUCKET/clubs/probe/logo.webp"
```

Record in the report: the exact JSON key holding the signed path, whether it is absolute or relative to `/storage/v1`, the header the PUT requires, and which headers the stat response returns for size and type. If any of it differs from what this task assumes below, **implement what you observed and say so in the report.** A wire format written from memory is the single most common source of defects in this project's history.

If `SUPABASE_SERVICE_ROLE_KEY` is empty, stop and report `BLOCKED`. Do not guess.

- [ ] **Step 2: Write the failing image-kinds test**

`apps/api/src/storage/image-kinds.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { IMAGE_KINDS, objectPath, publicUrl } from './image-kinds';

describe('objectPath', () => {
  it('builds a path under the kind folder from the resource id', () => {
    expect(objectPath('club-logo', 'abc')).toBe('clubs/abc/logo.webp');
    expect(objectPath('club-banner', 'abc')).toBe('clubs/abc/banner.webp');
  });

  it('refuses a resource id containing a path separator', () => {
    // Catches string interpolation with no validation. A resourceId of
    // "../../site" would write outside the club's folder, and the id
    // reaches this function from a request parameter.
    expect(() => objectPath('club-logo', '../site')).toThrow(/resource id/i);
    expect(() => objectPath('club-logo', 'a/b')).toThrow(/resource id/i);
  });

  it('refuses an empty resource id', () => {
    expect(() => objectPath('club-logo', '')).toThrow(/resource id/i);
  });
});

describe('publicUrl', () => {
  it('carries a version query so a replacement is a distinct URL', () => {
    // Catches a builder that omits ?v=. Deterministic object names mean a
    // replaced logo has the same URL, and every cache keeps serving the
    // old bytes.
    const url = publicUrl('https://x.supabase.co', 'clubs/abc/logo.webp', 1700000000000);
    expect(url).toBe(
      'https://x.supabase.co/storage/v1/object/public/majlis-storage/clubs/abc/logo.webp?v=1700000000000',
    );
  });

  it('does not double a slash when the base URL has a trailing one', () => {
    expect(publicUrl('https://x.supabase.co/', 'clubs/abc/logo.webp', 1)).not.toContain('.co//');
  });
});

describe('IMAGE_KINDS', () => {
  it('caps each kind below the 2 MB bucket limit', () => {
    // The bucket rejects anything over 2 MB. A per-kind cap above that is
    // dead configuration that never fires.
    for (const kind of Object.values(IMAGE_KINDS)) {
      expect(kind.maxBytes).toBeLessThan(2 * 1024 * 1024);
    }
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm --filter @majlis/api test -- image-kinds`
Expected: FAIL, module not found.

- [ ] **Step 4: Write image-kinds.ts**

```ts
import type { ImageKind } from '@majlis/contracts';

export const STORAGE_BUCKET = 'majlis-storage';

/**
 * Per-kind limits. The bucket itself is configured in the Supabase dashboard
 * with a 2 MB size limit and image/webp as the only allowed MIME type, and
 * that is the enforcement layer. These caps are tighter, and are what the
 * browser encodes toward and what statObject checks after the fact.
 */
export const IMAGE_KINDS = {
  'club-logo': { maxBytes: 256 * 1024, box: { w: 512, h: 512 }, square: true, file: 'logo.webp', folder: 'clubs' },
  'club-banner': { maxBytes: 512 * 1024, box: { w: 1600, h: 600 }, square: false, file: 'banner.webp', folder: 'clubs' },
} as const satisfies Record<
  ImageKind,
  { maxBytes: number; box: { w: number; h: number }; square: boolean; file: string; folder: string }
>;

/** A resource id may only ever be a bare UUID segment. */
const SAFE_SEGMENT = /^[A-Za-z0-9-]{1,64}$/;

/**
 * The only place an object path is built. The resource id arrives from a
 * request parameter, so a value containing a separator or a dot segment
 * would write into a folder the caller was never authorized for.
 */
export function objectPath(kind: ImageKind, resourceId: string): string {
  if (!SAFE_SEGMENT.test(resourceId)) {
    throw new Error(`Unsafe resource id for a storage path: ${JSON.stringify(resourceId)}`);
  }
  const spec = IMAGE_KINDS[kind];
  return `${spec.folder}/${resourceId}/${spec.file}`;
}

/**
 * Object names are deterministic, so replacing an image reuses the same
 * name. The version query is what makes the replacement a different URL,
 * which is the only thing stopping a CDN or a browser from serving the
 * previous bytes forever.
 */
export function publicUrl(baseUrl: string, path: string, version: number): string {
  const base = baseUrl.replace(/\/+$/, '');
  return `${base}/storage/v1/object/public/${STORAGE_BUCKET}/${path}?v=${version}`;
}
```

- [ ] **Step 5: Run it to verify it passes**

Run: `pnpm --filter @majlis/api test -- image-kinds`
Expected: PASS.

- [ ] **Step 6: Add the env keys**

In `apps/api/src/config/env.schema.ts`, add to the object:

```ts
    SUPABASE_STORAGE_URL: z
      .string()
      .refine((v) => v.startsWith('https://'), { message: 'must be an https URL' }),
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(20, 'must be a real service role key'),
```

Add to `apps/api/src/config/env.schema.spec.ts`'s `valid` and `base` fixtures:

```ts
  SUPABASE_STORAGE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'x'.repeat(40),
```

And a new test:

```ts
it('rejects an http Supabase URL, which would send the service key in clear', () => {
  const r = envSchema.safeParse({ ...base, SUPABASE_STORAGE_URL: 'http://example.supabase.co' });
  expect(r.success).toBe(false);
});
```

- [ ] **Step 7: Write the failing storage service test**

`apps/api/src/storage/storage.service.spec.ts`:

```ts
import { ConfigService } from '@nestjs/config';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StorageService } from './storage.service';

const KEY = 'service-role-key-value';

function serviceWith(fetchImpl: typeof fetch): StorageService {
  const config = new ConfigService({
    SUPABASE_STORAGE_URL: 'https://example.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: KEY,
  });
  vi.stubGlobal('fetch', fetchImpl);
  return new StorageService(config as never);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('createSignedUploadUrl', () => {
  it('authenticates with the service role key and returns an absolute URL', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const svc = serviceWith((async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ url: '/object/upload/sign/majlis-storage/clubs/a/logo.webp?token=tok' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch);

    const out = await svc.createSignedUploadUrl('clubs/a/logo.webp');

    // Catches a relative URL returned straight through: the browser would
    // PUT to the web app's own origin and the upload would 404.
    expect(out.signedUrl.startsWith('https://example.supabase.co/storage/v1/')).toBe(true);
    expect(out.token).toBe('tok');
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe(`Bearer ${KEY}`);
  });

  it('throws rather than returning a broken URL when Supabase refuses', async () => {
    // Catches a client that ignores the status and parses the error body as
    // a success, handing the browser an unusable URL and storing a logoUrl
    // for an object that was never created.
    const svc = serviceWith((async () =>
      new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })) as unknown as typeof fetch);

    await expect(svc.createSignedUploadUrl('clubs/a/logo.webp')).rejects.toThrow(/storage/i);
  });
});

describe('statObject', () => {
  it('returns null for an object that does not exist', async () => {
    const svc = serviceWith((async () => new Response(null, { status: 404 })) as unknown as typeof fetch);
    expect(await svc.statObject('clubs/a/logo.webp')).toBeNull();
  });

  it('reports the size and content type of an object that does exist', async () => {
    const svc = serviceWith((async () =>
      new Response(null, {
        status: 200,
        headers: { 'content-length': '1234', 'content-type': 'image/webp' },
      })) as unknown as typeof fetch);

    expect(await svc.statObject('clubs/a/logo.webp')).toEqual({ size: 1234, contentType: 'image/webp' });
  });

  it('treats a missing content-length as size zero rather than NaN', async () => {
    // Catches Number(null) reaching a `size > cap` comparison, which is
    // false for NaN, so an object of unknown size would pass verification.
    const svc = serviceWith((async () =>
      new Response(null, { status: 200, headers: { 'content-type': 'image/webp' } })) as unknown as typeof fetch);

    expect(await svc.statObject('clubs/a/logo.webp')).toEqual({ size: 0, contentType: 'image/webp' });
  });
});
```

- [ ] **Step 8: Run it to verify it fails**

Run: `pnpm --filter @majlis/api test -- storage.service`
Expected: FAIL, module not found.

- [ ] **Step 9: Write storage.service.ts**

Adjust the two request shapes to whatever Step 1 observed. The structure below is what the tests expect.

```ts
import { Injectable } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- value import: Nest DI resolves this from design:paramtypes.
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.schema';
import { STORAGE_BUCKET, publicUrl } from './image-kinds';

/**
 * Two calls against Supabase's Storage REST API. Deliberately not the
 * @supabase/supabase-js SDK, which carries auth, realtime and postgrest
 * clients for what is two HTTP requests.
 *
 * The service role key bypasses row level security entirely. It is read here
 * and nowhere else, never returned in a response, and never logged.
 */
@Injectable()
export class StorageService {
  private readonly baseUrl: string;
  private readonly key: string;

  constructor(config: ConfigService<Env, true>) {
    this.baseUrl = config.get('SUPABASE_STORAGE_URL', { infer: true }).replace(/\/+$/, '');
    this.key = config.get('SUPABASE_SERVICE_ROLE_KEY', { infer: true });
  }

  private headers(): Record<string, string> {
    return { Authorization: `Bearer ${this.key}`, apikey: this.key };
  }

  /**
   * A one-use, path-scoped upload URL. The path is built server-side from an
   * id the request was already authorized against, so the browser cannot
   * choose where its bytes land.
   */
  async createSignedUploadUrl(path: string): Promise<{ signedUrl: string; token: string }> {
    const res = await fetch(`${this.baseUrl}/storage/v1/object/upload/sign/${STORAGE_BUCKET}/${path}`, {
      method: 'POST',
      headers: this.headers(),
    });

    if (!res.ok) {
      // The body may carry the key back in an error echo. Only the status
      // is reported.
      throw new Error(`Storage refused to sign an upload URL: ${res.status}`);
    }

    const body = (await res.json()) as { url?: string };
    if (!body.url) throw new Error('Storage returned no signed URL.');

    const signedUrl = body.url.startsWith('http') ? body.url : `${this.baseUrl}/storage/v1${body.url}`;
    const token = new URL(signedUrl).searchParams.get('token') ?? '';
    return { signedUrl, token };
  }

  /**
   * Size and content type of an uploaded object, or null if it is not there.
   * This is what lets a handler refuse to store a URL for an upload that
   * never happened, which matters because the API never sees the bytes.
   */
  async statObject(path: string): Promise<{ size: number; contentType: string } | null> {
    const res = await fetch(`${this.baseUrl}/storage/v1/object/public/${STORAGE_BUCKET}/${path}`, {
      method: 'HEAD',
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Storage refused to stat an object: ${res.status}`);

    return {
      size: Number(res.headers.get('content-length') ?? 0),
      contentType: res.headers.get('content-type') ?? '',
    };
  }

  publicUrlFor(path: string, version: number): string {
    return publicUrl(this.baseUrl, path, version);
  }
}
```

`apps/api/src/storage/storage.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { StorageService } from './storage.service';

@Module({ providers: [StorageService], exports: [StorageService] })
export class StorageModule {}
```

- [ ] **Step 10: Run it to verify it passes**

Run: `pnpm --filter @majlis/api test -- storage`
Expected: PASS.

- [ ] **Step 11: Write the failing log redaction test**

Append to `apps/api/src/config/log-redaction.spec.ts`:

```ts
import { redactedReqSerializer } from './log-redaction';

describe('redactedReqSerializer', () => {
  it('drops the query string from the logged URL', () => {
    // Catches pino's default req serializer, which logs req.url verbatim.
    // Path-based redaction cannot strip a substring of a string value, so a
    // secret in a query parameter is redacted out of req.query and still
    // sits in req.url in the same log line.
    const out = redactedReqSerializer({
      id: 'r1',
      method: 'GET',
      url: '/api/v1/clubs?token=super-secret&limit=20',
      headers: {},
      query: {},
      params: {},
    } as never);

    expect(out.url).toBe('/api/v1/clubs');
    expect(JSON.stringify(out)).not.toContain('super-secret');
  });

  it('leaves a URL with no query string untouched', () => {
    const out = redactedReqSerializer({
      id: 'r1',
      method: 'GET',
      url: '/api/v1/health',
      headers: {},
      query: {},
      params: {},
    } as never);

    expect(out.url).toBe('/api/v1/health');
  });
});
```

- [ ] **Step 12: Run it to verify it fails**

Run: `pnpm --filter @majlis/api test -- log-redaction`
Expected: FAIL, `redactedReqSerializer` is not exported.

- [ ] **Step 13: Close the req.url gap**

In `apps/api/src/config/log-redaction.ts`, replace the "Known remaining exposure" paragraph with a note that it is closed by the serializer below, and append:

```ts
import { stdSerializers, type SerializedRequest } from 'pino';

/**
 * pino serializes req.url as one opaque string, so no redaction path can
 * strip a secret out of its query. The structured req.query is redacted by
 * the paths above; this drops the duplicate raw copy, keeping the path (the
 * part that carries the observability value) and discarding the query.
 */
export function redactedReqSerializer(req: Parameters<typeof stdSerializers.req>[0]): SerializedRequest {
  const serialized = stdSerializers.req(req);
  const cut = serialized.url.indexOf('?');
  return cut === -1 ? serialized : { ...serialized, url: serialized.url.slice(0, cut) };
}
```

In `apps/api/src/app.module.ts`, inside `pinoHttp`, add:

```ts
          serializers: { req: redactedReqSerializer },
```

- [ ] **Step 14: Add the env keys to .env.example**

```
SUPABASE_STORAGE_URL=
SUPABASE_SERVICE_ROLE_KEY=
```

- [ ] **Step 15: Run the whole API unit suite**

Run: `pnpm --filter @majlis/api test`
Expected: PASS.

- [ ] **Step 16: Commit**

```bash
git add apps/api/src/storage apps/api/src/config apps/api/src/app.module.ts .env.example
git commit -m "feat(storage): signed upload URLs, object verification, req.url redaction"
```

---

## Task 3: Departments

**Files:**
- Create: `apps/api/src/departments/departments.service.ts`, `departments.controller.ts`, `departments.module.ts`
- Create: `apps/api/test/departments.integration.test.ts`
- Modify: `apps/api/src/app.module.ts`

**Interfaces:**
- Consumes: `createDepartmentBodySchema`, `patchDepartmentBodySchema`, `Department`, `DepartmentPage` from Task 1.
- Produces: `DepartmentsModule`. Task 4 relies on a department existing before a club can be created.

- [ ] **Step 1: Write the failing integration test**

`apps/api/test/departments.integration.test.ts`. Follow the header pattern in `apps/api/test/users.integration.test.ts` exactly (`createTestApp`, `createTestPrisma`, `truncateAll` in `beforeEach`).

```ts
const DEPARTMENTS_PATH = `${API_PREFIX}/departments`;

describe('POST /departments', () => {
  it('creates one for an Admin', async () => {
    const admin = await loginAsAdmin(app);
    const res = await request(app.getHttpServer())
      .post(DEPARTMENTS_PATH)
      .set('Cookie', admin.sessionCookie)
      .send({ name: 'Computer Science', code: 'CS' });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ name: 'Computer Science', code: 'CS', clubCount: 0 });
  });

  it('refuses a STUDENT', async () => {
    const student = await loginAsStudent(app);
    const res = await request(app.getHttpServer())
      .post(DEPARTMENTS_PATH)
      .set('Cookie', student.sessionCookie)
      .send({ name: 'Computer Science', code: 'CS' });

    expect(res.status).toBe(403);
  });

  it('returns 409 for a duplicate code', async () => {
    const admin = await loginAsAdmin(app);
    const send = () =>
      request(app.getHttpServer())
        .post(DEPARTMENTS_PATH)
        .set('Cookie', admin.sessionCookie)
        .send({ name: uniq('Dept'), code: 'CS' });

    expect((await send()).status).toBe(201);
    // Catches a handler that lets Prisma's P2002 escape as a bare 500.
    expect((await send()).status).toBe(409);
  });
});

describe('DELETE /departments/:id', () => {
  it('refuses to delete a department that still has a club', async () => {
    // This is the onDelete: Restrict guarantee. Catches a service that
    // deletes without catching the foreign key violation, which surfaces as
    // a 500 and leaves the admin with no idea why.
    const admin = await loginAsAdmin(app);
    const dept = await prisma.department.create({ data: aDepartment() });
    await prisma.club.create({ data: aClub(dept.id) });

    const res = await request(app.getHttpServer())
      .delete(`${DEPARTMENTS_PATH}/${dept.id}`)
      .set('Cookie', admin.sessionCookie);

    expect(res.status).toBe(409);
    expect(await prisma.department.findUnique({ where: { id: dept.id } })).not.toBeNull();
  });

  it('deletes an empty department', async () => {
    const admin = await loginAsAdmin(app);
    const dept = await prisma.department.create({ data: aDepartment() });

    expect(
      (await request(app.getHttpServer())
        .delete(`${DEPARTMENTS_PATH}/${dept.id}`)
        .set('Cookie', admin.sessionCookie)).status,
    ).toBe(204);
    expect(await prisma.department.findUnique({ where: { id: dept.id } })).toBeNull();
  });
});

describe('GET /departments', () => {
  it('is readable by any signed-in user and reports the club count', async () => {
    const student = await loginAsStudent(app);
    const dept = await prisma.department.create({ data: aDepartment() });
    await prisma.club.create({ data: aClub(dept.id) });

    const res = await request(app.getHttpServer())
      .get(DEPARTMENTS_PATH)
      .set('Cookie', student.sessionCookie);

    expect(res.status).toBe(200);
    // Catches a count taken from the wrong relation or hardcoded to zero.
    expect(res.body.items.find((d: { id: string }) => d.id === dept.id).clubCount).toBe(1);
  });

  it('refuses an anonymous request', async () => {
    expect((await request(app.getHttpServer()).get(DEPARTMENTS_PATH)).status).toBe(401);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @majlis/api test:integration -- departments`
Expected: FAIL with 404 on every route.

- [ ] **Step 3: Write the service**

`apps/api/src/departments/departments.service.ts`. Key points:

- Inject `TransactionHost` and `AuditService`.
- `list` mirrors `UsersService.list`: `take: query.limit + 1`, cursor on `id`, `orderBy: { id: 'asc' }`, `include: { _count: { select: { clubs: true } } }`, map `_count.clubs` to `clubCount`.
- `create`, `update` and `remove` run inside `host.run` and write an audit row with actions `department.created`, `department.updated`, `department.deleted`.
- Map Prisma error codes rather than letting them escape:

```ts
import { Prisma } from '../generated/prisma/client';

function mapWriteError(e: unknown): never {
  if (e instanceof Prisma.PrismaClientKnownRequestError) {
    // P2002 is the unique violation on name or code; P2003 is the foreign
    // key violation raised by onDelete: Restrict when a club still points
    // at this department. Both are the caller's problem, not a 500.
    if (e.code === 'P2002') throw new ConflictError('A department with that name or code already exists.');
    if (e.code === 'P2003') throw new ConflictError('That department still has clubs.');
    if (e.code === 'P2025') throw new NotFoundError('No such department.');
  }
  throw e;
}
```

- [ ] **Step 4: Write the controller**

`apps/api/src/departments/departments.controller.ts`, following `users.controller.ts`:

```ts
@Controller('departments')
export class DepartmentsController {
  constructor(private readonly departments: DepartmentsService) {}

  @Get()
  list(@Query() query: DepartmentsQueryDto): Promise<DepartmentPage> { ... }

  @Post()
  @RequirePermission('department:manage')
  create(@Actor() actor: User, @Body() body: CreateDepartmentDto): Promise<Department> { ... }

  @Patch(':id')
  @RequirePermission('department:manage')
  update(@Actor() actor: User, @Param('id') id: string, @Body() body: PatchDepartmentDto): Promise<Department> { ... }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('department:manage')
  remove(@Actor() actor: User, @Param('id') id: string): Promise<void> { ... }
}
```

Add `@ApiResponse` declarations for 401, 403, 404 and 409 with `ProblemDetailsDto`, matching the style in `users.controller.ts`.

- [ ] **Step 5: Register the module**

Add `DepartmentsModule` to `AppModule`'s `imports`.

- [ ] **Step 6: Run the integration tests**

Run: `pnpm --filter @majlis/api test:integration -- departments`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/departments apps/api/test/departments.integration.test.ts apps/api/src/app.module.ts
git commit -m "feat(api): department CRUD with restrict-on-delete surfaced as 409"
```

---

## Task 4: Clubs, creation and reading

**Files:**
- Create: `apps/api/src/clubs/slug.ts`, `apps/api/src/clubs/slug.spec.ts`
- Create: `apps/api/src/clubs/clubs.service.ts`, `clubs.controller.ts`, `clubs.module.ts`
- Create: `apps/api/test/clubs-create.integration.test.ts`
- Modify: `apps/api/src/app.module.ts`

**Interfaces:**
- Consumes: `StorageService`, `objectPath`, `IMAGE_KINDS` (Task 2); `createClubBodySchema`, `clubListQuerySchema`, `ClubDetail`, `ClubPage`, `NewClubUpload` (Task 1).
- Produces:
  - `deriveSlug(name: string): string`
  - `uniqueSlug(base: string, taken: (s: string) => Promise<boolean>): Promise<string>`
  - `ClubsService.verifyUpload(kind: ImageKind, resourceId: string): Promise<string>` returning the versioned public URL, used by Tasks 4 and 5.
  - `ClubsModule`.

- [ ] **Step 1: Write the failing slug test**

`apps/api/src/clubs/slug.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { deriveSlug, uniqueSlug } from './slug';

describe('deriveSlug', () => {
  it('lowercases and hyphenates', () => {
    expect(deriveSlug('Robotics Club')).toBe('robotics-club');
  });

  it('collapses runs of punctuation into a single hyphen', () => {
    // Catches a naive .replace(/\s/g, '-'), which leaves "ai--ml" and
    // "robotics-" with a trailing hyphen.
    expect(deriveSlug('AI  &  ML')).toBe('ai-ml');
    expect(deriveSlug('Robotics!')).toBe('robotics');
    expect(deriveSlug('  Spaced  ')).toBe('spaced');
  });

  it('throws rather than returning an empty slug', () => {
    // Catches a name of only punctuation producing "", which would then
    // collide with every other such club and make an unreachable URL.
    expect(() => deriveSlug('!!!')).toThrow(/slug/i);
  });
});

describe('uniqueSlug', () => {
  it('returns the base when it is free', async () => {
    expect(await uniqueSlug('robotics', async () => false)).toBe('robotics');
  });

  it('suffixes until it finds a free one', async () => {
    // Catches an implementation that appends a fixed -2 and gives up, which
    // fails on the third club with the same name.
    const taken = new Set(['robotics', 'robotics-2', 'robotics-3']);
    expect(await uniqueSlug('robotics', async (s) => taken.has(s))).toBe('robotics-4');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @majlis/api test -- slug`
Expected: FAIL, module not found.

- [ ] **Step 3: Write slug.ts**

```ts
/**
 * The slug is the club's public identifier and is never editable after
 * creation, because rewriting it breaks every link that exists.
 */
export function deriveSlug(name: string): string {
  const slug = name
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  if (slug.length === 0) throw new Error(`Cannot derive a slug from ${JSON.stringify(name)}`);
  return slug.slice(0, 80);
}

/**
 * `taken` is injected rather than queried here so this stays a pure function
 * of its inputs and can be tested without a database.
 */
export async function uniqueSlug(base: string, taken: (candidate: string) => Promise<boolean>): Promise<string> {
  if (!(await taken(base))) return base;
  for (let n = 2; n < 1000; n += 1) {
    const candidate = `${base}-${n}`;
    if (!(await taken(candidate))) return candidate;
  }
  throw new Error(`No free slug for ${base}`);
}
```

- [ ] **Step 4: Write the failing creation integration test**

`apps/api/test/clubs-create.integration.test.ts`. The storage service is stubbed at the module level so no test touches Supabase:

```ts
import { StorageService } from '../src/storage/storage.service';

// createTestApp accepts an override hook; if it does not yet, add one that
// takes a list of { provide, useValue } and passes it to
// Test.createTestingModule(...).overrideProvider(...). Record the change in
// the report.
const fakeStorage = {
  createSignedUploadUrl: async (path: string) => ({
    signedUrl: `https://example.supabase.co/storage/v1/object/upload/sign/majlis-storage/${path}?token=t`,
    token: 't',
  }),
  statObject: async (path: string) => uploaded.get(path) ?? null,
  publicUrlFor: (path: string, version: number) =>
    `https://example.supabase.co/storage/v1/object/public/majlis-storage/${path}?v=${version}`,
};
const uploaded = new Map<string, { size: number; contentType: string }>();
```

```ts
describe('POST /uploads/club-logo then POST /clubs', () => {
  it('mints an id, then creates the club at that id', async () => {
    const admin = await loginAsAdmin(app);
    const dept = await prisma.department.create({ data: aDepartment() });

    const minted = await request(app.getHttpServer())
      .post(`${API_PREFIX}/uploads/club-logo`)
      .set('Cookie', admin.sessionCookie);
    expect(minted.status).toBe(201);

    const { clubId, path, publicUrl } = minted.body;
    expect(path).toBe(`clubs/${clubId}/logo.webp`);
    uploaded.set(path, { size: 1000, contentType: 'image/webp' });

    const res = await request(app.getHttpServer())
      .post(`${API_PREFIX}/clubs`)
      .set('Cookie', admin.sessionCookie)
      .send({
        clubId,
        departmentId: dept.id,
        name: 'Robotics Club',
        description: 'We build robots.',
        category: 'Technology',
        academicYear: '2026/2027',
        membershipPolicy: 'OPEN',
        logoUrl: publicUrl,
      });

    expect(res.status).toBe(201);
    expect(res.body.id).toBe(clubId);
    expect(res.body.slug).toBe('robotics-club');
  });

  it('refuses to create a club whose logo was never uploaded', async () => {
    // This is the whole point of verifying before storing. The API never
    // sees the bytes, so without this check a client can create a club with
    // a logoUrl pointing at nothing, and every screen renders a broken
    // image with no way to tell what went wrong.
    const admin = await loginAsAdmin(app);
    const dept = await prisma.department.create({ data: aDepartment() });
    const minted = await request(app.getHttpServer())
      .post(`${API_PREFIX}/uploads/club-logo`)
      .set('Cookie', admin.sessionCookie);
    // Deliberately do not populate `uploaded`.

    const res = await request(app.getHttpServer())
      .post(`${API_PREFIX}/clubs`)
      .set('Cookie', admin.sessionCookie)
      .send({ ...validBody(dept.id), clubId: minted.body.clubId, logoUrl: minted.body.publicUrl });

    expect(res.status).toBe(422);
    expect(await prisma.club.count()).toBe(0);
  });

  it('refuses an uploaded object that is over the kind cap', async () => {
    // Catches verification that checks existence but not size. The bucket
    // limit is 2 MB; the club logo cap is 256 KB, so a 1 MB object passes
    // the bucket and must still be refused here.
    const admin = await loginAsAdmin(app);
    const dept = await prisma.department.create({ data: aDepartment() });
    const minted = await request(app.getHttpServer())
      .post(`${API_PREFIX}/uploads/club-logo`)
      .set('Cookie', admin.sessionCookie);
    uploaded.set(minted.body.path, { size: 1_000_000, contentType: 'image/webp' });

    const res = await request(app.getHttpServer())
      .post(`${API_PREFIX}/clubs`)
      .set('Cookie', admin.sessionCookie)
      .send({ ...validBody(dept.id), clubId: minted.body.clubId, logoUrl: minted.body.publicUrl });

    expect(res.status).toBe(422);
  });

  it('refuses an uploaded object that is not WebP', async () => {
    const admin = await loginAsAdmin(app);
    const dept = await prisma.department.create({ data: aDepartment() });
    const minted = await request(app.getHttpServer())
      .post(`${API_PREFIX}/uploads/club-logo`)
      .set('Cookie', admin.sessionCookie);
    uploaded.set(minted.body.path, { size: 1000, contentType: 'image/png' });

    expect(
      (await request(app.getHttpServer())
        .post(`${API_PREFIX}/clubs`)
        .set('Cookie', admin.sessionCookie)
        .send({ ...validBody(dept.id), clubId: minted.body.clubId, logoUrl: minted.body.publicUrl })).status,
    ).toBe(422);
  });

  it('suffixes the slug when two clubs share a name', async () => {
    const admin = await loginAsAdmin(app);
    const dept = await prisma.department.create({ data: aDepartment() });
    const create = async (name: string) => {
      const minted = await request(app.getHttpServer())
        .post(`${API_PREFIX}/uploads/club-logo`)
        .set('Cookie', admin.sessionCookie);
      uploaded.set(minted.body.path, { size: 1000, contentType: 'image/webp' });
      return request(app.getHttpServer())
        .post(`${API_PREFIX}/clubs`)
        .set('Cookie', admin.sessionCookie)
        .send({ ...validBody(dept.id), name, clubId: minted.body.clubId, logoUrl: minted.body.publicUrl });
    };

    expect((await create('Robotics Club')).body.slug).toBe('robotics-club');
    // The name column is unique, so this must fail on name before slug.
    expect((await create('Robotics Club')).status).toBe(409);
    expect((await create('Robotics  Club!')).body.slug).toBe('robotics-club-2');
  });

  it('refuses a STUDENT', async () => {
    const student = await loginAsStudent(app);
    expect(
      (await request(app.getHttpServer())
        .post(`${API_PREFIX}/uploads/club-logo`)
        .set('Cookie', student.sessionCookie)).status,
    ).toBe(403);
  });
});

describe('GET /clubs', () => {
  it('filters by department and by status, and paginates', async () => {
    const student = await loginAsStudent(app);
    const a = await prisma.department.create({ data: aDepartment() });
    const b = await prisma.department.create({ data: aDepartment() });
    await prisma.club.create({ data: aClub(a.id) });
    await prisma.club.create({ data: aClub(b.id, { status: 'ARCHIVED' }) });

    const res = await request(app.getHttpServer())
      .get(`${API_PREFIX}/clubs?departmentId=${a.id}`)
      .set('Cookie', student.sessionCookie);

    // Catches a filter built but never applied to the where clause, which
    // returns everything and still looks correct in a one-club fixture.
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].departmentName).toBe(a.name);
  });

  it('caps limit at MAX_PAGE_LIMIT', async () => {
    const student = await loginAsStudent(app);
    expect(
      (await request(app.getHttpServer())
        .get(`${API_PREFIX}/clubs?limit=5000`)
        .set('Cookie', student.sessionCookie)).status,
    ).toBe(400);
  });
});

describe('GET /clubs/:clubId', () => {
  it('reports the viewer own membership status and roles, never another user', async () => {
    const student = await loginAsStudent(app);
    const other = await loginAsStudent(app);
    const dept = await prisma.department.create({ data: aDepartment() });
    const club = await prisma.club.create({ data: aClub(dept.id) });
    await prisma.clubMembership.create({
      data: { clubId: club.id, userId: other.userId, status: 'ACTIVE' },
    });

    const res = await request(app.getHttpServer())
      .get(`${API_PREFIX}/clubs/${club.id}`)
      .set('Cookie', student.sessionCookie);

    // Catches a findFirst with no userId filter, which returns whichever
    // membership row happens to come first and tells this student they are
    // already a member of a club they have never joined.
    expect(res.body.viewerMembershipStatus).toBeNull();
    expect(res.body.memberCount).toBe(1);
  });
});
```

- [ ] **Step 5: Run it to verify it fails**

Run: `pnpm --filter @majlis/api test:integration -- clubs-create`
Expected: FAIL with 404 on every route.

- [ ] **Step 6: Implement the service and controller**

`ClubsService`:

```ts
  /**
   * The API never sees the image bytes, so no handler stores a URL it has
   * not confirmed. Returns the versioned public URL to store.
   */
  async verifyUpload(kind: ImageKind, resourceId: string): Promise<string> {
    const path = objectPath(kind, resourceId);
    const stat = await this.storage.statObject(path);

    if (!stat) throw new UnprocessableError('That image was not uploaded.');
    if (stat.contentType !== 'image/webp') throw new UnprocessableError('That image is not a WebP.');
    if (stat.size > IMAGE_KINDS[kind].maxBytes) throw new UnprocessableError('That image is too large.');

    return this.storage.publicUrlFor(path, Date.now());
  }
```

`create` runs in `host.run`, calls `verifyUpload('club-logo', body.clubId)`, derives the slug with `uniqueSlug(deriveSlug(body.name), s => this.host.tx.club.count({ where: { slug: s } }).then(n => n > 0))`, inserts with the supplied `clubId` as the primary key, writes a `club.created` audit row, and maps `P2002` to `ConflictError('A club with that name already exists.')`.

`list` mirrors `UsersService.list`, with `where` assembled from the optional filters and `q` matched as `{ name: { contains: q, mode: 'insensitive' } }`, including `department: { select: { name: true } }` and `_count: { select: { memberships: { where: { status: 'ACTIVE' } } } }`.

`detail` loads the club plus, **scoped to the caller's own id**, their membership row and their ACTIVE appointments.

Controller routes, declared in this order so the static segment is matched before the parameter:

```ts
@Controller()
export class ClubsController {
  @Post('uploads/club-logo')
  @RequirePermission('club:create')
  mintClubLogoUpload(): Promise<NewClubUpload> { ... }

  @Post('clubs')
  @RequirePermission('club:create')
  create(@Actor() actor: User, @Body() body: CreateClubDto): Promise<ClubDetail> { ... }

  @Get('clubs')
  list(@Actor() actor: User, @Query() query: ClubListQueryDto): Promise<ClubPage> { ... }

  @Get('clubs/:clubId')
  detail(@Actor() actor: User, @Param('clubId') clubId: string): Promise<ClubDetail> { ... }
}
```

- [ ] **Step 7: Run the integration tests**

Run: `pnpm --filter @majlis/api test:integration -- clubs-create`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/clubs apps/api/test/clubs-create.integration.test.ts apps/api/src/app.module.ts
git commit -m "feat(api): club creation with verified logo upload, listing and detail"
```

---

## Task 5: Club editing and the status machine

**Files:**
- Create: `apps/api/src/clubs/club-status.ts`, `apps/api/src/clubs/club-status.spec.ts`
- Modify: `apps/api/src/clubs/clubs.service.ts`, `clubs.controller.ts`
- Create: `apps/api/test/clubs-status.integration.test.ts`

**Interfaces:**
- Consumes: `ClubsService.verifyUpload` (Task 4).
- Produces:
  - `assertTransition(from: ClubStatus, to: ClubStatus): void`
  - `assertAcceptsNewActivity(status: ClubStatus): void` and `assertAcceptsEdits(status: ClubStatus): void`, used by Tasks 6, 7 and 8.

- [ ] **Step 1: Write the failing status test**

`apps/api/src/clubs/club-status.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { assertAcceptsEdits, assertAcceptsNewActivity, assertTransition } from './club-status';

describe('assertTransition', () => {
  it('allows ACTIVE and SUSPENDED in both directions', () => {
    expect(() => assertTransition('ACTIVE', 'SUSPENDED')).not.toThrow();
    expect(() => assertTransition('SUSPENDED', 'ACTIVE')).not.toThrow();
  });

  it('allows archiving from either live state', () => {
    expect(() => assertTransition('ACTIVE', 'ARCHIVED')).not.toThrow();
    expect(() => assertTransition('SUSPENDED', 'ARCHIVED')).not.toThrow();
  });

  it('refuses every transition out of ARCHIVED', () => {
    // ARCHIVED is terminal. Catches a table built from the allowed pairs
    // without the terminal rule, which would let an admin quietly revive an
    // archived club and its entire history.
    expect(() => assertTransition('ARCHIVED', 'ACTIVE')).toThrow();
    expect(() => assertTransition('ARCHIVED', 'SUSPENDED')).toThrow();
    expect(() => assertTransition('ARCHIVED', 'ARCHIVED')).toThrow();
  });

  it('refuses a no-op transition', () => {
    expect(() => assertTransition('ACTIVE', 'ACTIVE')).toThrow();
  });
});

describe('activity gates', () => {
  it('blocks new activity in a suspended club but still allows edits', () => {
    // Spec 6.2: a suspended club freezes new memberships and events, while
    // officers keep their appointments and can still edit the profile.
    // Catches one combined gate used for both, which either blocks editing
    // a suspended club or admits new members to one.
    expect(() => assertAcceptsNewActivity('SUSPENDED')).toThrow();
    expect(() => assertAcceptsEdits('SUSPENDED')).not.toThrow();
  });

  it('blocks both in an archived club', () => {
    expect(() => assertAcceptsNewActivity('ARCHIVED')).toThrow();
    expect(() => assertAcceptsEdits('ARCHIVED')).toThrow();
  });

  it('allows both in an active club', () => {
    expect(() => assertAcceptsNewActivity('ACTIVE')).not.toThrow();
    expect(() => assertAcceptsEdits('ACTIVE')).not.toThrow();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @majlis/api test -- club-status`
Expected: FAIL, module not found.

- [ ] **Step 3: Write club-status.ts**

```ts
import type { ClubStatus } from '@majlis/contracts';
import { UnprocessableError } from '../common/problem/domain-error';

/** ARCHIVED is terminal and appears in no value list. */
const ALLOWED: Record<ClubStatus, ClubStatus[]> = {
  ACTIVE: ['SUSPENDED', 'ARCHIVED'],
  SUSPENDED: ['ACTIVE', 'ARCHIVED'],
  ARCHIVED: [],
};

/**
 * The only gate on a club status write. Every status change goes through
 * here; no handler assigns `status` directly.
 */
export function assertTransition(from: ClubStatus, to: ClubStatus): void {
  if (from === to) throw new UnprocessableError('That club is already in that state.');
  if (!ALLOWED[from].includes(to)) {
    throw new UnprocessableError(`A club cannot go from ${from} to ${to}.`);
  }
}

/** New memberships, new requests, and from Stage 5 new events. */
export function assertAcceptsNewActivity(status: ClubStatus): void {
  if (status !== 'ACTIVE') throw new UnprocessableError('That club is not accepting new activity.');
}

/** Profile edits, team changes, and membership decisions already in flight. */
export function assertAcceptsEdits(status: ClubStatus): void {
  if (status === 'ARCHIVED') throw new UnprocessableError('That club is archived.');
}
```

- [ ] **Step 4: Write the failing status integration test**

`apps/api/test/clubs-status.integration.test.ts`:

```ts
describe('PATCH /clubs/:clubId/status', () => {
  it('suspends and reactivates, writing an audit row each time', async () => {
    const admin = await loginAsAdmin(app);
    const club = await makeClub();

    expect(
      (await patchStatus(admin.sessionCookie, club.id, 'SUSPENDED', 'Inactive all semester.')).status,
    ).toBe(200);
    expect(
      (await patchStatus(admin.sessionCookie, club.id, 'ACTIVE', 'Back in operation.')).status,
    ).toBe(200);

    const rows = await prisma.auditLog.findMany({ where: { entityId: club.id }, orderBy: { createdAt: 'asc' } });
    expect(rows.map((r) => r.action)).toEqual(['club.suspended', 'club.reactivated']);
    // Catches a handler that writes the audit row without the reason, which
    // is what makes an override reviewable at all.
    expect(rows[0]!.reason).toBe('Inactive all semester.');
  });

  it('refuses any transition out of ARCHIVED', async () => {
    const admin = await loginAsAdmin(app);
    const club = await makeClub({ status: 'ARCHIVED' });

    expect((await patchStatus(admin.sessionCookie, club.id, 'ACTIVE', 'Revive.')).status).toBe(422);
  });

  it('refuses a Lead of the club', async () => {
    // Catches a rule copied from club:edit. A Lead who can archive their own
    // club has escaped the governance model.
    const club = await makeClub();
    const lead = await makeActiveLead(club.id);
    expect((await patchStatus(lead.sessionCookie, club.id, 'SUSPENDED', 'Mine now.')).status).toBe(403);
  });

  it('requires a reason', async () => {
    const admin = await loginAsAdmin(app);
    const club = await makeClub();
    const res = await request(app.getHttpServer())
      .patch(`${API_PREFIX}/clubs/${club.id}/status`)
      .set('Cookie', admin.sessionCookie)
      .send({ status: 'SUSPENDED' });
    expect(res.status).toBe(400);
  });
});

describe('PATCH /clubs/:clubId', () => {
  it('lets a Lead edit and refuses a plain member', async () => {
    const club = await makeClub();
    const lead = await makeActiveLead(club.id);
    const member = await loginAsStudent(app);
    await prisma.clubMembership.create({ data: { clubId: club.id, userId: member.userId, status: 'ACTIVE' } });

    expect((await patchClub(lead.sessionCookie, club.id, { category: 'Engineering' })).status).toBe(200);
    // Catches a handler with no @RequirePermission at all, which every
    // happy-path test would still pass.
    expect((await patchClub(member.sessionCookie, club.id, { category: 'Engineering' })).status).toBe(403);
  });

  it('refuses to edit an archived club but allows a suspended one', async () => {
    const archived = await makeClub({ status: 'ARCHIVED' });
    const archivedLead = await makeActiveLead(archived.id);
    expect((await patchClub(archivedLead.sessionCookie, archived.id, { category: 'X' })).status).toBe(422);

    const suspended = await makeClub({ status: 'SUSPENDED' });
    const suspendedLead = await makeActiveLead(suspended.id);
    expect((await patchClub(suspendedLead.sessionCookie, suspended.id, { category: 'X' })).status).toBe(200);
  });

  it('does not let the body smuggle status or slug', async () => {
    // Catches a service that spreads the request body into Prisma's data.
    // patchClubBodySchema has no status or slug key, so Zod strips them,
    // but a service that reads from the raw request instead of the DTO
    // would let a Lead archive their own club through the edit route.
    const club = await makeClub();
    const lead = await makeActiveLead(club.id);
    await patchClub(lead.sessionCookie, club.id, { status: 'ARCHIVED', slug: 'stolen' } as never);

    const after = await prisma.club.findUniqueOrThrow({ where: { id: club.id } });
    expect(after.status).toBe('ACTIVE');
    expect(after.slug).toBe(club.slug);
  });
});
```

`makeActiveLead(clubId)` signs up a student and creates a `ClubTeamAppointment` with `role: 'LEAD'`, `status: 'ACTIVE'`, `invitedById` set to any user id. Put it in `apps/api/test/factories.ts` so Tasks 6, 7 and 8 reuse it, and export it.

- [ ] **Step 5: Run it to verify it fails**

Run: `pnpm --filter @majlis/api test:integration -- clubs-status`
Expected: FAIL with 404.

- [ ] **Step 6: Implement**

Add to `ClubsService`:

- `updateStatus(actor, clubId, body)`: inside `host.run`, read the club, `assertTransition(before.status, body.status)`, update, write an audit row with action `club.suspended`, `club.reactivated` or `club.archived` and `reason: body.reason`, `before`/`after` snapshots of `{ status }`.
- `update(actor, clubId, body)`: inside `host.run`, read the club, `assertAcceptsEdits(club.status)`, build `data` by explicitly picking each optional key from the DTO (never spreading), call `verifyUpload` for `logoUrl` or `bannerUrl` when present, write a `club.updated` audit row.

Controller:

```ts
  @Patch('clubs/:clubId')
  @RequirePermission('club:edit', { scope: 'club', from: 'params.clubId' })
  update(...)

  @Patch('clubs/:clubId/status')
  @RequirePermission('club:status')
  updateStatus(...)

  @Post('clubs/:clubId/logo-upload-url')
  @RequirePermission('club:edit', { scope: 'club', from: 'params.clubId' })
  logoUploadUrl(...)

  @Post('clubs/:clubId/banner-upload-url')
  @RequirePermission('club:edit', { scope: 'club', from: 'params.clubId' })
  bannerUploadUrl(...)
```

- [ ] **Step 7: Run the integration tests**

Run: `pnpm --filter @majlis/api test:integration -- clubs`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/clubs apps/api/test
git commit -m "feat(api): club status machine and profile editing"
```

---

## Task 6: Lead appointment, team invitations and ending

**Files:**
- Create: `apps/api/src/clubs/team/team.service.ts`, `team.controller.ts`
- Modify: `apps/api/src/clubs/clubs.module.ts`
- Create: `apps/api/test/team.integration.test.ts`

**Interfaces:**
- Consumes: `assertAcceptsEdits` (Task 5); `inviteTeamMemberBodySchema`, `appointLeadBodySchema`, `Appointment`, `AppointmentPage` (Task 1).
- Produces: `TeamService.invite`, `.appointLead`, `.end`, `.list`. Task 7 adds accept and decline to the same service.

- [ ] **Step 1: Write the failing integration test**

`apps/api/test/team.integration.test.ts`:

```ts
describe('POST /clubs/:clubId/lead', () => {
  it('creates an INVITED appointment that grants nothing yet', async () => {
    const admin = await loginAsAdmin(app);
    const club = await makeClub();
    const nominee = await loginAsStudent(app);

    const res = await request(app.getHttpServer())
      .post(`${API_PREFIX}/clubs/${club.id}/lead`)
      .set('Cookie', admin.sessionCookie)
      .send({ userId: nominee.userId });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('INVITED');

    // The whole point of INVITED. Catches an appointment created ACTIVE,
    // which hands full Lead authority to someone who never accepted.
    expect(
      (await request(app.getHttpServer())
        .patch(`${API_PREFIX}/clubs/${club.id}`)
        .set('Cookie', nominee.sessionCookie)
        .send({ category: 'Engineering' })).status,
    ).toBe(403);
  });

  it('refuses a Lead appointing their own successor', async () => {
    const club = await makeClub();
    const lead = await makeActiveLead(club.id);
    const nominee = await loginAsStudent(app);

    expect(
      (await request(app.getHttpServer())
        .post(`${API_PREFIX}/clubs/${club.id}/lead`)
        .set('Cookie', lead.sessionCookie)
        .send({ userId: nominee.userId })).status,
    ).toBe(403);
  });
});

describe('the one ACTIVE Lead index', () => {
  it('admits two INVITED Leads but only the first acceptance', async () => {
    // The partial unique index covers ACTIVE rows only, so a club can hold
    // several INVITED candidates at once and the constraint fires at
    // acceptance. Correct, and surprising enough to pin down. Two distinct
    // users, because a single user would collide on other grounds and the
    // test would pass against a broken index.
    const admin = await loginAsAdmin(app);
    const club = await makeClub();
    const first = await loginAsStudent(app);
    const second = await loginAsStudent(app);

    const inviteLead = (userId: string) =>
      request(app.getHttpServer())
        .post(`${API_PREFIX}/clubs/${club.id}/lead`)
        .set('Cookie', admin.sessionCookie)
        .send({ userId });

    const a = await inviteLead(first.userId);
    const b = await inviteLead(second.userId);
    expect([a.status, b.status]).toEqual([201, 201]);

    expect(
      (await request(app.getHttpServer())
        .post(`${API_PREFIX}/appointments/${a.body.id}/accept`)
        .set('Cookie', first.sessionCookie)).status,
    ).toBe(201);

    expect(
      (await request(app.getHttpServer())
        .post(`${API_PREFIX}/appointments/${b.body.id}/accept`)
        .set('Cookie', second.sessionCookie)).status,
    ).toBe(409);

    const active = await prisma.clubTeamAppointment.findMany({
      where: { clubId: club.id, role: 'LEAD', status: 'ACTIVE' },
    });
    expect(active).toHaveLength(1);
    expect(active[0]!.userId).toBe(first.userId);
  });
});

describe('POST /clubs/:clubId/team', () => {
  it('lets a Lead invite an officer and refuses a Vice Lead', async () => {
    const club = await makeClub();
    const lead = await makeActiveLead(club.id);
    const vice = await makeActiveOfficer(club.id, 'VICE_LEAD');
    const nominee = await loginAsStudent(app);

    const invite = (cookie: string) =>
      request(app.getHttpServer())
        .post(`${API_PREFIX}/clubs/${club.id}/team`)
        .set('Cookie', cookie)
        .send({ userId: nominee.userId, role: 'MARKETING' });

    expect((await invite(lead.sessionCookie)).status).toBe(201);
    // Spec 6.1 gives "invite / end team appointments" to Lead only.
    expect((await invite(vice.sessionCookie)).status).toBe(403);
  });

  it('refuses a Lead inviting themselves', async () => {
    const club = await makeClub();
    const lead = await makeActiveLead(club.id);

    expect(
      (await request(app.getHttpServer())
        .post(`${API_PREFIX}/clubs/${club.id}/team`)
        .set('Cookie', lead.sessionCookie)
        .send({ userId: lead.userId, role: 'CTO' })).status,
    ).toBe(422);
  });
});

describe('DELETE /clubs/:clubId/team/:appointmentId', () => {
  it('refuses an appointment that belongs to another club', async () => {
    // Deviation D5. The guard resolves scope from params.clubId, so a Lead
    // of club A passing club A's id with club B's appointment id would end
    // another club's officer unless the handler checks ownership.
    const clubA = await makeClub();
    const clubB = await makeClub();
    const leadA = await makeActiveLead(clubA.id);
    const officerB = await makeActiveOfficer(clubB.id, 'OPERATIONS');

    const res = await request(app.getHttpServer())
      .delete(`${API_PREFIX}/clubs/${clubA.id}/team/${officerB.appointmentId}`)
      .set('Cookie', leadA.sessionCookie)
      .send({ reason: 'Cross club attempt.' });

    expect(res.status).toBe(404);
    const after = await prisma.clubTeamAppointment.findUniqueOrThrow({
      where: { id: officerB.appointmentId },
    });
    expect(after.status).toBe('ACTIVE');
  });

  it('ends an appointment without deleting the row or the membership', async () => {
    const club = await makeClub();
    const lead = await makeActiveLead(club.id);
    const officer = await makeActiveOfficer(club.id, 'MARKETING');
    await prisma.clubMembership.create({
      data: { clubId: club.id, userId: officer.userId, status: 'ACTIVE' },
    });

    expect(
      (await request(app.getHttpServer())
        .delete(`${API_PREFIX}/clubs/${club.id}/team/${officer.appointmentId}`)
        .set('Cookie', lead.sessionCookie)
        .send({ reason: 'Term over.' })).status,
    ).toBe(204);

    const row = await prisma.clubTeamAppointment.findUniqueOrThrow({ where: { id: officer.appointmentId } });
    expect(row.status).toBe('ENDED');
    expect(row.endedReason).toBe('Term over.');

    // Losing a role is not the same as leaving the club.
    const membership = await prisma.clubMembership.findFirstOrThrow({
      where: { clubId: club.id, userId: officer.userId },
    });
    expect(membership.status).toBe('ACTIVE');
  });

  it('refuses a Lead ending their own appointment', async () => {
    const club = await makeClub();
    const lead = await makeActiveLead(club.id);

    expect(
      (await request(app.getHttpServer())
        .delete(`${API_PREFIX}/clubs/${club.id}/team/${lead.appointmentId}`)
        .set('Cookie', lead.sessionCookie)
        .send({ reason: 'Resigning.' })).status,
    ).toBe(422);
  });
});
```

Add `makeActiveOfficer(clubId, role)` to `factories.ts`, returning `{ userId, sessionCookie, appointmentId }`. Extend `makeActiveLead` to return `appointmentId` too.

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @majlis/api test:integration -- team`
Expected: FAIL with 404.

- [ ] **Step 3: Implement TeamService**

Every write runs inside `host.run` and writes an audit row.

- `appointLead(actor, clubId, body)`: load the club, `assertAcceptsEdits`, refuse `body.userId === actor.id` with `UnprocessableError`, create the appointment with `role: 'LEAD'`, `status: 'INVITED'`, `invitedById: actor.id`, `invitationExpiresAt: now + 14 days`. Audit `club.lead_invited`.
- `invite(actor, clubId, body)`: same, with the role from the DTO, which excludes LEAD at the schema boundary. Refuse when an ACTIVE appointment for that user and role already exists, with `ConflictError`.
- `end(actor, clubId, appointmentId, body)`: load with `where: { id: appointmentId, clubId }` so an appointment from another club is simply not found. `NotFoundError` if missing, `UnprocessableError` if `appointment.userId === actor.id`, `UnprocessableError` if `status !== 'ACTIVE'`. Set `status: 'ENDED'`, `endedAt`, `endedReason`. Audit `club.appointment_ended`.
- `list(clubId, query)`: cursor-paginated, includes the user's name and email, and computes `hasLeftClub` from the membership row.

Controller, all routes under `@Controller()` with full paths:

```ts
  @Post('clubs/:clubId/lead')
  @RequirePermission('club:appoint-lead')
  appointLead(...)

  @Get('clubs/:clubId/team')
  list(...)

  @Post('clubs/:clubId/team')
  @RequirePermission('club:team-manage', { scope: 'club', from: 'params.clubId' })
  invite(...)

  @Delete('clubs/:clubId/team/:appointmentId')
  @HttpCode(204)
  @RequirePermission('club:team-manage', { scope: 'club', from: 'params.clubId' })
  end(...)
```

Map `P2002` on the Lead index to `ConflictError('That club already has an active Lead.')`.

- [ ] **Step 4: Run the integration tests**

Run: `pnpm --filter @majlis/api test:integration -- team`
Expected: PASS, except the two-Lead test, which needs Task 7's accept route. Mark that one `it.todo` here and re-enable it in Task 7 Step 5.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/clubs/team apps/api/test
git commit -m "feat(api): Lead appointment, team invitations and ending"
```

---

## Task 7: Invitations, acceptance and expiry

**Files:**
- Modify: `apps/api/src/clubs/team/team.service.ts`, `team.controller.ts`
- Create: `apps/api/test/invitations.integration.test.ts`
- Modify: `apps/api/test/team.integration.test.ts` (re-enable the two-Lead test)

**Interfaces:**
- Consumes: everything from Task 6.
- Produces: `TeamService.myInvitations`, `.accept`, `.decline`.

- [ ] **Step 1: Write the failing integration test**

`apps/api/test/invitations.integration.test.ts`:

```ts
describe('GET /me/invitations', () => {
  it('lists only the caller own pending invitations', async () => {
    const club = await makeClub();
    const mine = await loginAsStudent(app);
    const theirs = await loginAsStudent(app);
    await inviteOfficer(club.id, mine.userId, 'MARKETING');
    await inviteOfficer(club.id, theirs.userId, 'CTO');

    const res = await request(app.getHttpServer())
      .get(`${API_PREFIX}/me/invitations`)
      .set('Cookie', mine.sessionCookie);

    // Catches a findMany with no userId filter, which shows every pending
    // invitation in the system to every signed-in student.
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].role).toBe('MARKETING');
  });

  it('hides an expired invitation', async () => {
    const club = await makeClub();
    const user = await loginAsStudent(app);
    const appt = await inviteOfficer(club.id, user.userId, 'CTO');
    await prisma.clubTeamAppointment.update({
      where: { id: appt.id },
      data: { invitationExpiresAt: new Date(Date.now() - 1000) },
    });

    const res = await request(app.getHttpServer())
      .get(`${API_PREFIX}/me/invitations`)
      .set('Cookie', user.sessionCookie);

    // Catches a query filtering on status alone. An invitation that expired
    // would stay in the list forever and fail only on acceptance.
    expect(res.body.items).toHaveLength(0);
  });
});

describe('POST /appointments/:appointmentId/accept', () => {
  it('activates the appointment and creates the ordinary membership', async () => {
    const club = await makeClub();
    const user = await loginAsStudent(app);
    const appt = await inviteOfficer(club.id, user.userId, 'OPERATIONS');

    expect(
      (await request(app.getHttpServer())
        .post(`${API_PREFIX}/appointments/${appt.id}/accept`)
        .set('Cookie', user.sessionCookie)).status,
    ).toBe(201);

    const row = await prisma.clubTeamAppointment.findUniqueOrThrow({ where: { id: appt.id } });
    expect(row.status).toBe('ACTIVE');
    expect(row.acceptedAt).not.toBeNull();

    // Main spec 7.2: a team member automatically receives an ordinary club
    // membership on acceptance. Catches an accept handler that flips the
    // status and stops, leaving an officer who is not a member of their own
    // club and vanishes from the member list.
    const membership = await prisma.clubMembership.findFirstOrThrow({
      where: { clubId: club.id, userId: user.userId },
    });
    expect(membership.status).toBe('ACTIVE');
  });

  it('does not create a second membership when one is already open', async () => {
    // Catches an unconditional create, which violates the partial unique
    // index and turns an ordinary acceptance into a 500 for anyone who was
    // already a member before being invited to the team.
    const club = await makeClub();
    const user = await loginAsStudent(app);
    await prisma.clubMembership.create({ data: { clubId: club.id, userId: user.userId, status: 'ACTIVE' } });
    const appt = await inviteOfficer(club.id, user.userId, 'CTO');

    expect(
      (await request(app.getHttpServer())
        .post(`${API_PREFIX}/appointments/${appt.id}/accept`)
        .set('Cookie', user.sessionCookie)).status,
    ).toBe(201);
    expect(await prisma.clubMembership.count({ where: { clubId: club.id, userId: user.userId } })).toBe(1);
  });

  it('refuses acceptance by anyone other than the invitee, with 404', async () => {
    // 404 rather than 403 so the endpoint does not confirm that an
    // appointment id exists to someone who has no business knowing.
    const club = await makeClub();
    const invitee = await loginAsStudent(app);
    const stranger = await loginAsStudent(app);
    const appt = await inviteOfficer(club.id, invitee.userId, 'CTO');

    expect(
      (await request(app.getHttpServer())
        .post(`${API_PREFIX}/appointments/${appt.id}/accept`)
        .set('Cookie', stranger.sessionCookie)).status,
    ).toBe(404);
    expect(
      (await prisma.clubTeamAppointment.findUniqueOrThrow({ where: { id: appt.id } })).status,
    ).toBe('INVITED');
  });

  it('refuses an expired invitation and marks it EXPIRED', async () => {
    const club = await makeClub();
    const user = await loginAsStudent(app);
    const appt = await inviteOfficer(club.id, user.userId, 'CTO');
    await prisma.clubTeamAppointment.update({
      where: { id: appt.id },
      data: { invitationExpiresAt: new Date(Date.now() - 1000) },
    });

    expect(
      (await request(app.getHttpServer())
        .post(`${API_PREFIX}/appointments/${appt.id}/accept`)
        .set('Cookie', user.sessionCookie)).status,
    ).toBe(422);
    expect(
      (await prisma.clubTeamAppointment.findUniqueOrThrow({ where: { id: appt.id } })).status,
    ).toBe('EXPIRED');
  });

  it('refuses a second acceptance of the same invitation', async () => {
    const club = await makeClub();
    const user = await loginAsStudent(app);
    const appt = await inviteOfficer(club.id, user.userId, 'CTO');
    const accept = () =>
      request(app.getHttpServer())
        .post(`${API_PREFIX}/appointments/${appt.id}/accept`)
        .set('Cookie', user.sessionCookie);

    expect((await accept()).status).toBe(201);
    expect((await accept()).status).toBe(422);
  });
});

describe('POST /appointments/:appointmentId/decline', () => {
  it('declines without creating a membership', async () => {
    const club = await makeClub();
    const user = await loginAsStudent(app);
    const appt = await inviteOfficer(club.id, user.userId, 'CTO');

    expect(
      (await request(app.getHttpServer())
        .post(`${API_PREFIX}/appointments/${appt.id}/decline`)
        .set('Cookie', user.sessionCookie)).status,
    ).toBe(201);

    expect(
      (await prisma.clubTeamAppointment.findUniqueOrThrow({ where: { id: appt.id } })).status,
    ).toBe('DECLINED');
    expect(await prisma.clubMembership.count({ where: { clubId: club.id, userId: user.userId } })).toBe(0);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @majlis/api test:integration -- invitations`
Expected: FAIL with 404.

- [ ] **Step 3: Implement acceptance**

In `TeamService`:

```ts
  /**
   * Expiry is evaluated on read rather than by a job, matching the main
   * spec's "no queue, the lifecycle is lazy" decision. An invitation past
   * its date is flipped to EXPIRED opportunistically, here, when someone
   * tries to use it.
   */
  async accept(actor: User, appointmentId: string): Promise<Appointment> {
    return this.host.run(async () => {
      // Scoped to the actor, so an appointment belonging to someone else is
      // not found rather than forbidden.
      const appt = await this.host.tx.clubTeamAppointment.findFirst({
        where: { id: appointmentId, userId: actor.id },
      });
      if (!appt) throw new NotFoundError('No such invitation.');
      if (appt.status !== 'INVITED') throw new UnprocessableError('That invitation is no longer open.');

      if (appt.invitationExpiresAt && appt.invitationExpiresAt.getTime() < Date.now()) {
        await this.host.tx.clubTeamAppointment.update({
          where: { id: appt.id },
          data: { status: 'EXPIRED' },
        });
        throw new UnprocessableError('That invitation has expired.');
      }

      const club = await this.host.tx.club.findUniqueOrThrow({ where: { id: appt.clubId } });
      assertAcceptsEdits(club.status);

      const activated = await this.host.tx.clubTeamAppointment.update({
        where: { id: appt.id },
        data: { status: 'ACTIVE', acceptedAt: new Date(), termStart: new Date() },
      });

      // Main spec 7.2. Conditional, because the partial unique index
      // forbids a second open membership and an officer may already be one.
      const open = await this.host.tx.clubMembership.findFirst({
        where: { clubId: appt.clubId, userId: actor.id, status: { in: ['PENDING', 'ACTIVE'] } },
      });
      if (open) {
        if (open.status === 'PENDING') {
          await this.host.tx.clubMembership.update({
            where: { id: open.id },
            data: { status: 'ACTIVE', decidedAt: new Date(), decidedById: actor.id },
          });
        }
      } else {
        await this.host.tx.clubMembership.create({
          data: { clubId: appt.clubId, userId: actor.id, status: 'ACTIVE' },
        });
      }

      await this.audit.record({
        action: 'club.appointment_accepted',
        entityType: 'ClubTeamAppointment',
        entityId: appt.id,
        outcome: 'SUCCESS',
        actorUserId: actor.id,
        before: { status: appt.status },
        after: { status: 'ACTIVE' },
      });

      return toAppointment(activated);
    });
  }
```

The `UnprocessableError` for an expired invitation is thrown after the `EXPIRED` write, inside the same `host.run`, which rolls that write back. Do not leave it that way: follow the pattern in `AuthService.refresh` and return a discriminated result from the transaction, then throw outside it, so the `EXPIRED` flip commits. Write the test for that explicitly:

```ts
  it('commits the EXPIRED flip even though the request fails', async () => {
    // Catches the naive version: throwing inside host.run rolls back the
    // status write, so the invitation stays INVITED and expires again on
    // every subsequent attempt, forever.
    // (assertion is in the expired-invitation test above, which reads the
    // row back after the 422)
  });
```

`decline` is the same shape without the membership branch. `myInvitations` filters `{ userId: actor.id, status: 'INVITED', OR: [{ invitationExpiresAt: null }, { invitationExpiresAt: { gt: new Date() } }] }`.

Routes:

```ts
  @Get('me/invitations')
  myInvitations(@Actor() actor: User, @Query() query: CursorQueryDto) { ... }

  @Post('appointments/:appointmentId/accept')
  accept(@Actor() actor: User, @Param('appointmentId') id: string) { ... }

  @Post('appointments/:appointmentId/decline')
  decline(@Actor() actor: User, @Param('appointmentId') id: string) { ... }
```

None carries `@RequirePermission`. Authorization is the `userId: actor.id` filter in the query.

- [ ] **Step 4: Run the integration tests**

Run: `pnpm --filter @majlis/api test:integration -- invitations`
Expected: PASS.

- [ ] **Step 5: Re-enable the two-Lead test**

Change `it.todo` back to `it` in `apps/api/test/team.integration.test.ts`.

Run: `pnpm --filter @majlis/api test:integration -- team`
Expected: PASS, including the 409 on the second Lead acceptance.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/clubs/team apps/api/test
git commit -m "feat(api): in-app invitations, acceptance, lazy expiry"
```

---

## Task 8: Membership

**Files:**
- Create: `apps/api/src/clubs/membership/membership.service.ts`, `membership.controller.ts`
- Modify: `apps/api/src/clubs/clubs.module.ts`
- Create: `apps/api/test/membership.integration.test.ts`

**Interfaces:**
- Consumes: `assertAcceptsNewActivity`, `assertAcceptsEdits` (Task 5); `decideMembershipBodySchema`, `addMemberBodySchema`, `Member`, `MemberPage`, `MyClubPage` (Task 1).
- Produces: `MembershipService`. Nothing later in this stage depends on it.

- [ ] **Step 1: Write the failing integration test**

`apps/api/test/membership.integration.test.ts`:

```ts
describe('POST /clubs/:clubId/membership-requests, by policy', () => {
  it('joins immediately under OPEN', async () => {
    const club = await makeClub({ membershipPolicy: 'OPEN' });
    const student = await loginAsStudent(app);
    const res = await join(student.sessionCookie, club.id);

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('ACTIVE');
  });

  it('creates a PENDING request under APPROVAL_REQUIRED', async () => {
    const club = await makeClub({ membershipPolicy: 'APPROVAL_REQUIRED' });
    const student = await loginAsStudent(app);
    const res = await join(student.sessionCookie, club.id);

    // Catches a handler that ignores the policy and always writes ACTIVE,
    // which every OPEN test would still pass.
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('PENDING');
  });

  it('refuses under INVITE_ONLY and under CLOSED', async () => {
    for (const policy of ['INVITE_ONLY', 'CLOSED'] as const) {
      const club = await makeClub({ membershipPolicy: policy });
      const student = await loginAsStudent(app);
      expect((await join(student.sessionCookie, club.id)).status).toBe(422);
      expect(await prisma.clubMembership.count({ where: { clubId: club.id } })).toBe(0);
    }
  });

  it('refuses joining a suspended or archived club whatever the policy', async () => {
    for (const status of ['SUSPENDED', 'ARCHIVED'] as const) {
      const club = await makeClub({ membershipPolicy: 'OPEN', status });
      const student = await loginAsStudent(app);
      expect((await join(student.sessionCookie, club.id)).status).toBe(422);
    }
  });

  it('returns 409 for a second request while one is open', async () => {
    const club = await makeClub({ membershipPolicy: 'APPROVAL_REQUIRED' });
    const student = await loginAsStudent(app);
    expect((await join(student.sessionCookie, club.id)).status).toBe(201);
    expect((await join(student.sessionCookie, club.id)).status).toBe(409);
  });

  it('lets someone who left request again', async () => {
    // LEFT is outside the partial unique index predicate, which is what
    // makes rejoining possible at all. Catches an index built on
    // (club_id, user_id) with no WHERE clause, which would lock a student
    // out of a club forever the moment they left it once.
    const club = await makeClub({ membershipPolicy: 'OPEN' });
    const student = await loginAsStudent(app);
    await join(student.sessionCookie, club.id);
    await request(app.getHttpServer())
      .delete(`${API_PREFIX}/clubs/${club.id}/membership`)
      .set('Cookie', student.sessionCookie);

    expect((await join(student.sessionCookie, club.id)).status).toBe(201);
  });

  it('admits exactly one membership when two requests race', async () => {
    // Two real concurrent requests, not two sequential calls. A sequential
    // pair passes against a check-then-insert implementation; only genuine
    // concurrency exercises the index.
    const club = await makeClub({ membershipPolicy: 'OPEN' });
    const student = await loginAsStudent(app);

    const results = await Promise.allSettled([
      join(student.sessionCookie, club.id),
      join(student.sessionCookie, club.id),
    ]);

    const codes = results.map((r) => (r.status === 'fulfilled' ? r.value.status : 500)).sort();
    expect(codes).toEqual([201, 409]);
    expect(
      await prisma.clubMembership.count({
        where: { clubId: club.id, userId: student.userId, status: { in: ['PENDING', 'ACTIVE'] } },
      }),
    ).toBe(1);
  });
});

describe('PATCH /clubs/:clubId/membership-requests/:requestId', () => {
  it('lets Operations approve and refuses Marketing', async () => {
    const club = await makeClub({ membershipPolicy: 'APPROVAL_REQUIRED' });
    const ops = await makeActiveOfficer(club.id, 'OPERATIONS');
    const marketing = await makeActiveOfficer(club.id, 'MARKETING');
    const applicant = await loginAsStudent(app);
    const req = await join(applicant.sessionCookie, club.id);

    expect((await decide(marketing.sessionCookie, club.id, req.body.id, 'ACTIVE')).status).toBe(403);
    expect((await decide(ops.sessionCookie, club.id, req.body.id, 'ACTIVE')).status).toBe(200);
  });

  it('refuses a request that belongs to another club', async () => {
    // Deviation D5, same class of bug as the team route.
    const clubA = await makeClub({ membershipPolicy: 'APPROVAL_REQUIRED' });
    const clubB = await makeClub({ membershipPolicy: 'APPROVAL_REQUIRED' });
    const leadA = await makeActiveLead(clubA.id);
    const applicant = await loginAsStudent(app);
    const reqB = await join(applicant.sessionCookie, clubB.id);

    expect((await decide(leadA.sessionCookie, clubA.id, reqB.body.id, 'ACTIVE')).status).toBe(404);
    expect(
      (await prisma.clubMembership.findUniqueOrThrow({ where: { id: reqB.body.id } })).status,
    ).toBe('PENDING');
  });

  it('refuses an officer deciding their own request', async () => {
    // Main spec 6.2. Catches a handler with the permission check but not
    // the self check, which is the whole rule.
    const club = await makeClub({ membershipPolicy: 'APPROVAL_REQUIRED' });
    const ops = await makeActiveOfficer(club.id, 'OPERATIONS');
    await prisma.clubMembership.deleteMany({ where: { clubId: club.id, userId: ops.userId } });
    const own = await join(ops.sessionCookie, club.id);

    expect((await decide(ops.sessionCookie, club.id, own.body.id, 'ACTIVE')).status).toBe(422);
  });

  it('refuses deciding a row that is not PENDING', async () => {
    const club = await makeClub({ membershipPolicy: 'APPROVAL_REQUIRED' });
    const lead = await makeActiveLead(club.id);
    const applicant = await loginAsStudent(app);
    const req = await join(applicant.sessionCookie, club.id);

    expect((await decide(lead.sessionCookie, club.id, req.body.id, 'ACTIVE')).status).toBe(200);
    expect((await decide(lead.sessionCookie, club.id, req.body.id, 'REJECTED')).status).toBe(422);
  });
});

describe('POST /clubs/:clubId/members', () => {
  it('is the way in under INVITE_ONLY', async () => {
    const club = await makeClub({ membershipPolicy: 'INVITE_ONLY' });
    const lead = await makeActiveLead(club.id);
    const student = await loginAsStudent(app);

    const res = await request(app.getHttpServer())
      .post(`${API_PREFIX}/clubs/${club.id}/members`)
      .set('Cookie', lead.sessionCookie)
      .send({ userId: student.userId });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('ACTIVE');
  });

  it('refuses a plain member adding someone', async () => {
    const club = await makeClub({ membershipPolicy: 'INVITE_ONLY' });
    const member = await loginAsStudent(app);
    await prisma.clubMembership.create({ data: { clubId: club.id, userId: member.userId, status: 'ACTIVE' } });
    const outsider = await loginAsStudent(app);

    expect(
      (await request(app.getHttpServer())
        .post(`${API_PREFIX}/clubs/${club.id}/members`)
        .set('Cookie', member.sessionCookie)
        .send({ userId: outsider.userId })).status,
    ).toBe(403);
  });
});

describe('leaving and removal', () => {
  it('sets LEFT for the caller and REMOVED for an officer removal', async () => {
    const club = await makeClub({ membershipPolicy: 'OPEN' });
    const lead = await makeActiveLead(club.id);
    const student = await loginAsStudent(app);
    await join(student.sessionCookie, club.id);

    expect(
      (await request(app.getHttpServer())
        .delete(`${API_PREFIX}/clubs/${club.id}/membership`)
        .set('Cookie', student.sessionCookie)).status,
    ).toBe(204);
    expect(
      (await prisma.clubMembership.findFirstOrThrow({ where: { clubId: club.id, userId: student.userId } })).status,
    ).toBe('LEFT');

    const other = await loginAsStudent(app);
    await join(other.sessionCookie, club.id);
    expect(
      (await request(app.getHttpServer())
        .delete(`${API_PREFIX}/clubs/${club.id}/members/${other.userId}`)
        .set('Cookie', lead.sessionCookie)).status,
    ).toBe(204);
    // The two must be distinguishable: REMOVED is a decision someone made,
    // LEFT is the member's own. Catches both routes writing LEFT.
    expect(
      (await prisma.clubMembership.findFirstOrThrow({ where: { clubId: club.id, userId: other.userId } })).status,
    ).toBe('REMOVED');
  });
});

describe('GET /clubs/:clubId/members', () => {
  it('filters by status and shows club roles', async () => {
    const club = await makeClub({ membershipPolicy: 'APPROVAL_REQUIRED' });
    const lead = await makeActiveLead(club.id);
    const pending = await loginAsStudent(app);
    await join(pending.sessionCookie, club.id);

    const res = await request(app.getHttpServer())
      .get(`${API_PREFIX}/clubs/${club.id}/members?status=PENDING`)
      .set('Cookie', lead.sessionCookie);

    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].userId).toBe(pending.userId);
  });
});

describe('GET /me/clubs', () => {
  it('lists the caller memberships with their roles', async () => {
    const club = await makeClub({ membershipPolicy: 'OPEN' });
    const student = await loginAsStudent(app);
    await join(student.sessionCookie, club.id);

    const res = await request(app.getHttpServer())
      .get(`${API_PREFIX}/me/clubs`)
      .set('Cookie', student.sessionCookie);

    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].clubId).toBe(club.id);
    expect(res.body.items[0].clubRoles).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @majlis/api test:integration -- membership`
Expected: FAIL with 404.

- [ ] **Step 3: Implement MembershipService**

- `request(actor, clubId)`: `host.run`, load the club, `assertAcceptsNewActivity(club.status)`, then switch on `club.membershipPolicy`: `OPEN` creates `ACTIVE`, `APPROVAL_REQUIRED` creates `PENDING`, `INVITE_ONLY` and `CLOSED` throw `UnprocessableError`. Map `P2002` to `ConflictError('You already have an open membership in that club.')`. Audit `club.membership_requested` or `club.membership_joined`.
- `addMember(actor, clubId, body)`: `assertAcceptsNewActivity`, create `ACTIVE` with `decidedById: actor.id`, `decidedAt: now`. Audit `club.member_added`.
- `decide(actor, clubId, requestId, body)`: load with `where: { id: requestId, clubId }`, `NotFoundError` if missing. `UnprocessableError` if `row.userId === actor.id` or `row.status !== 'PENDING'`. Update, audit `club.membership_approved` or `club.membership_rejected`.
- `leave(actor, clubId)` and `remove(actor, clubId, userId)`: set `LEFT` and `REMOVED` respectively. Both `assertAcceptsEdits`.
- `members(clubId, query)` and `myClubs(actor, query)`: cursor-paginated on `id`.

Routes:

```ts
  @Get('clubs/:clubId/members')
  members(...)

  @Post('clubs/:clubId/members')
  @RequirePermission('membership:decide', { scope: 'club', from: 'params.clubId' })
  addMember(...)

  @Delete('clubs/:clubId/members/:userId')
  @HttpCode(204)
  @RequirePermission('membership:decide', { scope: 'club', from: 'params.clubId' })
  remove(...)

  @Post('clubs/:clubId/membership-requests')
  request(...)

  @Patch('clubs/:clubId/membership-requests/:requestId')
  @RequirePermission('membership:decide', { scope: 'club', from: 'params.clubId' })
  decide(...)

  @Delete('clubs/:clubId/membership')
  @HttpCode(204)
  leave(...)

  @Get('me/clubs')
  myClubs(...)
```

Declare `clubs/:clubId/members` before `clubs/:clubId/membership` is irrelevant (different segments), but **declare `clubs/:clubId/members/:userId` after `clubs/:clubId/members`** so the collection route is not shadowed.

- [ ] **Step 4: Run the whole integration suite**

Run: `pnpm --filter @majlis/api test:integration`
Expected: PASS, all files.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/clubs/membership apps/api/test
git commit -m "feat(api): membership policies, decisions, member lists and leaving"
```

---

## Task 9: Web foundation, image conversion and upload

**Files:**
- Create: `apps/web/src/lib/image.ts`, `apps/web/src/lib/image.test.ts`
- Create: `apps/web/src/lib/clubs.ts`
- Create: `apps/web/src/components/ImageUpload.tsx`
- Create: `apps/web/src/components/ui/select.tsx`, `textarea.tsx`, `dialog.tsx`, `table.tsx`

**Interfaces:**
- Consumes: `apiFetch` and `ProblemError` from `apps/web/src/lib/api.ts`; every contract type from Task 1.
- Produces:
  - `fitBox(source: {w:number;h:number}, box: {w:number;h:number}, square: boolean): {w:number;h:number}`
  - `IMAGE_KINDS` mirrored client-side with the same values as the API's
  - `convertToWebp(file: File, kind: ImageKind): Promise<Blob>`
  - `<ImageUpload kind clubId? onUploaded={(publicUrl: string, clubId: string) => void} />`
  - Typed fetch wrappers in `lib/clubs.ts` for every endpoint in Tasks 3 through 8.

- [ ] **Step 1: Write the failing conversion test**

`apps/web/src/lib/image.test.ts`. `fitBox` is pure and is the part worth testing directly; canvas encoding is exercised by the Playwright suite in Task 12.

```ts
import { describe, expect, it } from 'vitest';
import { fitBox, MAX_SOURCE_BYTES } from './image';

describe('fitBox', () => {
  it('scales a landscape image down to fit the box, preserving ratio', () => {
    expect(fitBox({ w: 3200, h: 1200 }, { w: 1600, h: 600 }, false)).toEqual({ w: 1600, h: 600 });
    expect(fitBox({ w: 3200, h: 800 }, { w: 1600, h: 600 }, false)).toEqual({ w: 1600, h: 400 });
  });

  it('does not upscale an image smaller than the box', () => {
    // Catches a naive scale factor of box.w / source.w, which blows a
    // 100px logo up to 512px and makes it blurry for no benefit.
    expect(fitBox({ w: 100, h: 80 }, { w: 512, h: 512 }, false)).toEqual({ w: 100, h: 80 });
  });

  it('returns a square for a square kind, cropping the long side', () => {
    expect(fitBox({ w: 1000, h: 400 }, { w: 512, h: 512 }, true)).toEqual({ w: 400, h: 400 });
    expect(fitBox({ w: 300, h: 900 }, { w: 512, h: 512 }, true)).toEqual({ w: 300, h: 300 });
  });

  it('caps a square kind at the box size', () => {
    expect(fitBox({ w: 4000, h: 4000 }, { w: 512, h: 512 }, true)).toEqual({ w: 512, h: 512 });
  });
});

describe('MAX_SOURCE_BYTES', () => {
  it('is large enough for a phone photo and small enough to refuse before decoding', () => {
    expect(MAX_SOURCE_BYTES).toBe(10 * 1024 * 1024);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @majlis/web test -- image`
Expected: FAIL, module not found.

- [ ] **Step 3: Write image.ts**

```ts
import type { ImageKind } from '@majlis/contracts';

/** Refused without decoding, so a huge file cannot exhaust memory first. */
export const MAX_SOURCE_BYTES = 10 * 1024 * 1024;

/** Mirrors IMAGE_KINDS in apps/api/src/storage/image-kinds.ts. */
export const IMAGE_KINDS = {
  'club-logo': { maxBytes: 256 * 1024, box: { w: 512, h: 512 }, square: true },
  'club-banner': { maxBytes: 512 * 1024, box: { w: 1600, h: 600 }, square: false },
} as const satisfies Record<ImageKind, { maxBytes: number; box: { w: number; h: number }; square: boolean }>;

const QUALITY_LADDER = [0.82, 0.7, 0.6];

export function fitBox(
  source: { w: number; h: number },
  box: { w: number; h: number },
  square: boolean,
): { w: number; h: number } {
  if (square) {
    const side = Math.min(source.w, source.h, box.w);
    return { w: side, h: side };
  }
  // Never above 1: an image smaller than the box stays its own size.
  const scale = Math.min(box.w / source.w, box.h / source.h, 1);
  return { w: Math.round(source.w * scale), h: Math.round(source.h * scale) };
}

/**
 * Resize and re-encode in the browser. The API never sees these bytes, so
 * the bucket's own 2 MB and image/webp restrictions are the enforcement;
 * this is what makes a normal upload land well under them.
 */
export async function convertToWebp(file: File, kind: ImageKind): Promise<Blob> {
  if (file.size > MAX_SOURCE_BYTES) {
    throw new Error('That file is over 10 MB. Choose a smaller one.');
  }

  const spec = IMAGE_KINDS[kind];
  const bitmap = await createImageBitmap(file);
  const target = fitBox({ w: bitmap.width, h: bitmap.height }, spec.box, spec.square);

  const canvas = document.createElement('canvas');
  canvas.width = target.w;
  canvas.height = target.h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This browser cannot process images.');

  if (spec.square) {
    // Centre crop: take the largest centred square of the source.
    const side = Math.min(bitmap.width, bitmap.height);
    const sx = (bitmap.width - side) / 2;
    const sy = (bitmap.height - side) / 2;
    ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, target.w, target.h);
  } else {
    ctx.drawImage(bitmap, 0, 0, target.w, target.h);
  }
  bitmap.close();

  for (const quality of QUALITY_LADDER) {
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/webp', quality),
    );
    if (blob && blob.size <= spec.maxBytes) return blob;
  }

  throw new Error('That image is too detailed to compress. Choose a simpler one.');
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter @majlis/web test -- image`
Expected: PASS.

- [ ] **Step 5: Add the four shadcn components**

Add `select`, `textarea`, `dialog` and `table` following the existing files in `apps/web/src/components/ui/`. Re-point every colour at our own tokens exactly as `input.tsx` and `sheet.tsx` do. Form controls use `--color-border-control`, never `--color-border`. Motion uses `--dur` and `--ease-out`; `dialog.tsx` needs hand-written keyframes like `sheet.tsx`, because Tailwind v4 has no `animate-in` utilities here.

- [ ] **Step 6: Write ImageUpload.tsx**

A Client Component. States: idle, converting, uploading, done, refused. The refusal message is the error's own text, which `convertToWebp` writes to be actionable. No explanatory copy in the idle state: a file input styled as a button, and the current image as the preview.

```tsx
'use client';

export function ImageUpload({ kind, clubId, onUploaded, currentUrl }: Props) {
  // 1. convertToWebp(file, kind)
  // 2. POST the upload-url endpoint for this kind, via lib/clubs.ts
  // 3. PUT the blob to signedUrl with the header Step 1 of Task 2 recorded
  // 4. onUploaded(publicUrl, clubId ?? minted clubId)
}
```

The `<input type="file">` keeps a real `id` and a visible `<label htmlFor>`, because the axe suite in Task 12 checks WCAG 4.1.2 on it. Progress is announced with `aria-live="polite"`.

- [ ] **Step 7: Write lib/clubs.ts**

One exported async function per endpoint, each returning the contract type and letting `ProblemError` propagate. No new abstraction over `apiFetch`.

- [ ] **Step 8: Typecheck, lint and test**

Run: `pnpm typecheck && pnpm lint && pnpm --filter @majlis/web test`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/lib apps/web/src/components
git commit -m "feat(web): browser WebP conversion, upload control, club API client"
```

---

## Task 10: Admin screens

**Files:**
- Modify: `apps/web/src/app/(admin)/admin/departments/page.tsx`
- Modify: `apps/web/src/app/(admin)/admin/clubs/page.tsx`
- Create: `apps/web/src/app/(admin)/admin/clubs/new/page.tsx`
- Create: `apps/web/src/app/(admin)/admin/clubs/[clubId]/page.tsx`

**Interfaces:**
- Consumes: `lib/clubs.ts`, `ImageUpload`, the four new ui components (Task 9).
- Produces: nothing other tasks depend on.

- [ ] **Step 1: Departments page**

Server Component listing departments in a `Table` with name, code and club count. A `Dialog` for create and edit. Delete shows a confirm `Dialog`; a 409 renders the problem detail as the refusal, not a generic failure.

Empty state uses `EmptyState` with a title and an action only. No `description` prop exists and none is added.

- [ ] **Step 2: Clubs list page**

Table with logo, name, department, status via `StatusBadge`, member count. Filters for department and status as `Select`. Link to `clubs/new` and to each `clubs/[clubId]`.

- [ ] **Step 3: Club creation page**

The order matters and is the whole reason this page exists as its own route:

1. `ImageUpload` with `kind="club-logo"` and no `clubId`. It calls `POST /uploads/club-logo`, which mints the id, and reports both the minted `clubId` and the `publicUrl`.
2. The rest of the form stays disabled until the upload reports done, because `logoUrl` is required.
3. Submit posts `POST /clubs` carrying the minted `clubId` and `publicUrl`.

Fields: name, department (`Select`), category, academic year, membership policy (`Select`), description (`Textarea`). Every one uses `Field`, which has no `description` prop.

- [ ] **Step 4: Club detail page**

Profile, current Lead, status control, and Lead appointment.

The status control is a `Select` of the legal next states plus a required reason `Textarea` in a `Dialog`. An archived club shows its state and offers no transition, because none is legal.

Lead appointment is a user search against `GET /users` with a confirm. The pending invitation stays visible with its expiry until it is answered.

- [ ] **Step 5: Verify by hand**

Run both servers, sign in as `admin@uni.ac.ae` / `Passw0rd!`, and walk the whole flow: create a department, create a club with a real logo file, appoint a Lead, suspend and reactivate, archive. Confirm the archived club offers no further transition.

Record in the report what you actually saw, not what the code implies.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app/\(admin\)
git commit -m "feat(web): admin departments, club creation, status and Lead appointment"
```

---

## Task 11: Officer console screens

**Files:**
- Modify: `apps/web/src/app/(club)/manage/[clubId]/overview/page.tsx`
- Modify: `apps/web/src/app/(club)/manage/[clubId]/team/page.tsx`
- Modify: `apps/web/src/app/(club)/manage/[clubId]/members/page.tsx`

**Interfaces:**
- Consumes: `lib/clubs.ts`, `ImageUpload` (Task 9).
- Produces: nothing.

- [ ] **Step 1: Overview page**

Profile edit for Lead and Vice Lead: department, category, academic year, description, membership policy. Logo and banner replacement through `ImageUpload` with an existing `clubId`.

A suspended club shows its status and still allows editing. An archived club shows its status and renders the form read-only, matching `assertAcceptsEdits`.

Marketing and CTO reach this page through the nav and see the profile without edit controls, because Stage 4 grants them no edit permission (deviation D4). Hiding the control is presentation; the server refuses regardless.

- [ ] **Step 2: Team page**

Table of appointments: person, role via `StatusBadge`, status, expiry for an invitation, and a flag for an officer who has left the club. Invite through a `Dialog` with user search and a role `Select` that offers the four non-Lead roles. End an appointment through a confirm `Dialog` with a required reason.

Only a Lead sees the invite and end controls. A Lead's own row offers no end control, since the server refuses it.

- [ ] **Step 3: Members page**

Two sections: pending requests with approve and reject, and the member list with removal. Requests are visible to Lead, Vice Lead and Operations. Add a member directly through a `Dialog`, which is the only route in under `INVITE_ONLY`.

Rejecting takes an optional reason. Removing takes a confirm.

- [ ] **Step 4: Verify by hand**

Sign in as `lead@uni.ac.ae`, then `ops@uni.ac.ae`. Confirm Operations sees the requests queue and not the team invite control. Confirm an archived club is read-only.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/\(club\)
git commit -m "feat(web): officer console profile, team and membership screens"
```

---

## Task 12: Student screens and the accessibility suite

**Files:**
- Modify: `apps/web/src/app/(student)/clubs/page.tsx`
- Create: `apps/web/src/app/(student)/clubs/[slug]/page.tsx`
- Modify: `apps/web/src/app/(student)/me/page.tsx`
- Modify: `apps/web/e2e/a11y.spec.ts`

**Interfaces:**
- Consumes: everything from Tasks 9 through 11.
- Produces: the finished stage.

- [ ] **Step 1: Clubs browse page**

Search and a department filter. Cards with logo, name, category, member count. Cursor pagination with a load-more control, never an unbounded fetch.

- [ ] **Step 2: Club detail page**

Resolved by slug. Banner, logo, description, department, category, academic year, member count.

The join control is driven entirely by policy and by `viewerMembershipStatus`:

| Policy | Viewer state | Control |
|---|---|---|
| `OPEN` | none, `LEFT`, `REJECTED` | Join |
| `APPROVAL_REQUIRED` | none, `LEFT`, `REJECTED` | Request to join |
| `INVITE_ONLY` or `CLOSED` | none | Disabled control, with the policy as its accessible name |
| any | `PENDING` | Request pending, no action |
| any | `ACTIVE` | Leave, behind a confirm |
| any | `REMOVED` | No control |

A disabled control still needs an accessible name that says why it is disabled, or the refusal exists only in the layout and a screen reader user learns nothing.

- [ ] **Step 3: Me page**

Two lists. My clubs, each with a leave action behind a confirm. My invitations, each with accept and decline, showing the club and role. An accepted invitation moves the club into the first list without a reload.

- [ ] **Step 4: Extend the axe suite**

Add to `apps/web/e2e/a11y.spec.ts`, in both themes at both existing viewports:

- student clubs list, student club detail with an active join control, student club detail with a disabled join control, student me page with a pending invitation
- admin departments, admin club creation form, admin club detail with the status dialog open
- officer team page with the invite dialog open, officer members page

The dialog-open scans matter most: `sheet.tsx`'s equivalent scan in Stage 3 is what found the real `aria-hidden` violation in the account menu.

- [ ] **Step 5: Prove the new scans discriminate**

Temporarily remove the accessible name from the disabled join control. Run the suite. Both themes must fail on WCAG 4.1.2. Restore it and confirm green.

A suite that is green on its first run is a question, not an answer. Record both runs in the report.

- [ ] **Step 6: Run every gate**

```bash
pnpm typecheck && pnpm lint && pnpm test
pnpm --filter @majlis/api test:integration
API_ORIGIN=http://localhost:3001 pnpm build
pnpm --filter @majlis/web test:e2e
```

Expected: all green. Report the actual counts.

- [ ] **Step 7: Commit**

```bash
git add apps/web
git commit -m "feat(web): student club browse, detail, joining, invitations, axe coverage"
```

---

## Self-review

**Spec coverage.** Every section of the design maps to a task: §3 storage to Task 2 and Task 9, §4 departments to Task 3, §5 clubs to Tasks 4 and 5, §6 team to Tasks 6 and 7, §7 membership to Task 8, §8 permissions to Task 1, §9 API surface across Tasks 3 through 8, §10 invariants to Tasks 3, 6 and 8, §11 screens to Tasks 10 through 12, §12 testing throughout.

**Two things this plan adds that the spec did not name.** Deviation D5, nesting the two flat routes under their club so the guard can resolve scope, with the cross-club ownership test in Tasks 6 and 8. And the `EXPIRED` commit ordering in Task 7, which the spec's "flipped opportunistically" wording does not survive naively, because throwing inside `host.run` rolls the flip back.

**Not covered, deliberately.** Field-level edit permissions (D4, Stage 5). Orphaned upload sweeping (spec §13). `invitationTokenHash` stays null (spec §13).

**Security review** runs before this branch merges, per `CLAUDE.md`: this stage introduces a service role key, signed upload URLs, and six permission rows.
