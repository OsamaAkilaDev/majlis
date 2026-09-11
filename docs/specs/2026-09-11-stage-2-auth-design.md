# Stage 2 — Auth & Users

**Status:** Approved, pre-implementation
**Date:** 2026-09-11
**Parent:** [`2026-09-10-majlis-design.md`](2026-09-10-majlis-design.md) — the binding authority. This
document refines its §5.1, §6, §8 and §11 for Stage 2 only. Where the two disagree,
the parent wins, except for the three deviations recorded in §9 below, which are
approved reversals.

Scope: the API only. There is no `apps/web` until Stage 3, so this stage ships no
screens. It is done when the migrations run, every endpoint below is tested against a
real PostgreSQL 18, and the guards fail closed.

---

## 1. What this stage has to guarantee

Four properties. Everything below exists to make one of them true, and every test
earns its place by failing when one of them breaks.

1. **A suspended user can do nothing, starting on their very next request** — not
   when their token expires.
2. **A stolen refresh token is detectable and self-destructing.** Using a rotated
   token kills the entire family, so a thief locks out the victim rather than
   shadowing them indefinitely.
3. **Authorization is re-derived from the database on every request**, from no input
   the client controls.
4. **An audit row and the action it records commit or roll back together.** Never one
   without the other.

---

## 2. Module layout

```
apps/api/src/
  auth/
    auth.module.ts
    auth.controller.ts               signup · login · refresh · logout · me
    auth.service.ts                  the four flows, each inside host.run()
    tokens.service.ts                sign/verify access JWT; mint/hash refresh tokens
    cookies.ts                       PURE — cookie names and attribute builders
    session.guard.ts                 global; resolves the actor, rejects SUSPENDED
    permissions.guard.ts             global; reads @RequirePermission, loads scope facts
    permissions.ts                   PURE — the matrix and evaluate()
    require-permission.decorator.ts
    public.decorator.ts
    actor.decorator.ts
  users/
    users.module.ts  users.controller.ts  users.service.ts
  audit/
    audit.module.ts  audit.service.ts
  common/
    request-context.ts               AsyncLocalStorage: requestId, ip, userAgent
packages/contracts/src/
  auth/index.ts                      signup · login · session schemas
  users/index.ts                     profile · user summary · status change
apps/api/test/
  factories.ts                       uniq() · aUser() · aClub() — carried item #4
```

### 2.1 The one structural decision

**`permissions.ts` is a pure module, not a service.** It exports a data table and a
function:

```ts
evaluate(permission: Permission, facts: ActorFacts): boolean
```

`ActorFacts` is everything the evaluator is permitted to know, already loaded from the
database by the guard. The guard does the I/O; the function does the deciding.

This is not decoration. Parent §12 lists "permission derivation" under **unit** tests,
and this split is what makes that possible: the whole of parent §6.1 becomes testable
with no database, no Nest container, and no HTTP — which is the only way a matrix that
will eventually have ~25 rows × 8 roles gets exhaustive coverage rather than
spot-checks.

---

## 3. Tokens and cookies

| | Access token | Refresh token |
|---|---|---|
| Form | JWT, HS256 | 256 bits from `crypto.randomBytes`, base64url |
| Lifetime | 15 min (`ACCESS_TOKEN_TTL`) | 30 days (`REFRESH_TOKEN_TTL`) |
| Server-side record | none | `refresh_token` row |
| What is stored | — | SHA-256 of the token; **never the token** |
| Cookie | `majlis_session` | `majlis_refresh` |
| Cookie `Path` | `/` | `/api/v1/auth` |

Both cookies: `HttpOnly`, `SameSite=Lax`, and `Secure` whenever `NODE_ENV !==
'development'`. Parent §9.2 puts a Next.js rewrite in front of the API so the browser
sees one origin — the cookies are first-party and there is no CORS configuration to
get wrong.

### 3.1 The access token payload is `{ sub, iat, exp }` and nothing else

No role. No club IDs. No permission list.

Parent §6.2 promises that *"losing an appointment takes effect on the very next
request, because permissions are re-derived per request and never cached in the
session."* A role claim in the JWT makes that statement false for up to fifteen
minutes — and makes it false **invisibly**, because every test written by someone who
knows the role lives in the token will put it there and pass.

The guard therefore loads the user on every request. The JWT's only job is to prove
which `sub` the browser is entitled to claim.

### 3.2 Refresh tokens are hashed with SHA-256, not argon2id

Passwords are argon2id. Refresh tokens are not passwords.

A 256-bit random string has no structure to guess and no dictionary to attack, so the
work factor that makes argon2id correct for a human-chosen password buys nothing here
and would add ~100 ms to every refresh. SHA-256 gives the property that actually
matters — a database dump yields no usable token — at a cost that lets `token_hash`
stay a `@unique` indexed lookup.

`token_hash` is already `@unique` in the schema, which is also what makes the
`FOR UPDATE` lock in §4.3 lock exactly one row.

### 3.3 `Path=/api/v1/auth` on the refresh cookie

The refresh token is needed by four endpoints. Scoping its path keeps it out of the
~60 requests per session that later stages will make to everything else, so the
credential with the 30-day lifetime is transmitted roughly as often as it is used.

### 3.4 Rotation extends the lifetime (sliding window)

A rotated token's successor gets a fresh 30 days. An actively used session therefore
never expires, which is the behaviour every product of this shape has.

There is deliberately **no absolute family cap.** The family dies on logout, on
suspension, on reuse detection, and on 30 days of inactivity — four exits is enough,
and a fifth would need a `family_started_at` column the schema does not have.

### 3.5 New environment variables

Added to [`env.schema.ts`](../../apps/api/src/config/env.schema.ts), which already
refuses to boot on a bad value:

| Variable | Rule |
|---|---|
| `SESSION_SECRET` | Minimum 32 characters. **In production, must not equal the `.env.example` value.** |
| `ACCESS_TOKEN_TTL` | Duration string, default `15m` |
| `REFRESH_TOKEN_TTL` | Duration string, default `30d` |

The production check on `SESSION_SECRET` matters more than it looks: the failure mode
it prevents is a deployment that boots, serves traffic, and signs every session with a
secret published in the repository.

---

## 4. Endpoints

All under `/api/v1`. Request and response shapes are Zod schemas in
`packages/contracts`, per parent §4.2 — never hand-written DTOs.

### 4.1 `POST /auth/signup` · public · throttled

Creates an `ACTIVE` `STUDENT`, argon2id-hashes the password, issues both cookies.

**Email is lowercased in the Zod schema**, at the boundary, before it reaches a
service. The `user` table carries `CHECK (email = lower(email))`
([migration](../../apps/api/prisma/migrations/20260910200533_identity/migration.sql)),
so an un-normalised insert fails on a constraint violation rather than storing bad
data — the constraint is doing its job, but a 500 is the wrong way to learn that.

Duplicate email → `ConflictError` (409). Prisma `P2002` is also mapped to 409 by the
existing filter, so the race between two simultaneous signups of the same address
resolves correctly without an application-level pre-check.

### 4.2 `POST /auth/login` · public · throttled

**An unknown email and a wrong password are indistinguishable.** Same status, same
Problem Details body, and argon2 is run against a fixed dummy hash when no user is
found, so the response time does not separate the two cases either. Without the dummy
verify, the timing difference between "no user, return immediately" and "user found,
spend 100 ms hashing" is a reliable account-existence oracle over a handful of
requests.

One deliberate exception: a **suspended** user who supplies the **correct** password
receives a distinct 403 naming suspension as the cause. This only reveals account
existence to someone who has already proven they know the password, and the
alternative sends a suspended student to the IT helpdesk to debug a password that is
in fact correct, instead of to the Admin who suspended them.

Login mints a **new family** (`family_id = uuid7()`).

### 4.3 `POST /auth/refresh` · public · throttled

The whole flow runs inside one `host.run()`:

```
hash ← sha256(cookie)
row  ← SELECT * FROM refresh_token WHERE token_hash = hash FOR UPDATE

if no row                        → 401
if row.revoked_at or replaced_by → REUSE: revoke every live row in the family,
                                   write a DENIED audit row, 401
if row.expires_at <= now         → 401
user ← load; if missing or SUSPENDED → 401

successor ← INSERT refresh_token (same family_id, fresh 30d)
UPDATE row SET revoked_at = now, replaced_by_id = successor.id
issue both cookies
```

`FOR UPDATE` is what makes reuse detection race-free. `token_hash` is unique, so the
lock is on exactly one row. Two concurrent requests bearing the same token serialise:
the winner rotates and commits; the loser then reads a row with `revoked_at` set and
correctly classifies it as reuse. This is the behaviour approved during design — the
security property stays absolute, and the benign two-tab race is mitigated on the
client in Stage 3 by a single deduped refresh mutation per tab.

Reuse detection is the one auth event that is genuinely a security incident, so it is
the one that writes an audit row.

### 4.4 `POST /auth/logout` · public

Revokes the presented token's entire family and clears both cookies. **Idempotent:**
no cookie, an unknown token, or an already-revoked one all return 204 with the cookies
cleared. Logout must never fail — a user who cannot log out is a worse outcome than a
redundant no-op.

It is `@Public()` because an expired access token must not prevent logging out.

### 4.5 `GET /auth/me` · authenticated

The session identity plus the role facts the shells need for routing: `id`, `email`,
`fullName`, `avatarUrl`, `platformRole`, and `clubRoles` (an array of `{ clubId, role
}` from `ACTIVE` appointments — empty for every user in Stage 2, populated from Stage
4 with no contract change).

This is distinct from `GET /me` on purpose. `/auth/me` answers *"who is this session
and where does `/` redirect them"* (parent §9.1). `/me` answers *"what can this person
edit about themselves"*. Collapsing them would put authorization facts into the
profile-edit response shape.

### 4.6 `GET /me` · `PATCH /me` · authenticated

Read and update `fullName` and `avatarUrl`. Email is immutable in this stage — it is
the identity key (parent §5.1) and changing it needs a verification flow that does not
exist.

### 4.7 `GET /users` · `@RequirePermission('user:list')`

Cursor-paginated with the existing
[`cursorPageQuerySchema`](../../packages/contracts/src/common/pagination.ts), whose
`max(100)` on `limit` is what makes parent §8's "no unbounded list, anywhere" a
property of the type rather than a habit.

### 4.8 `PATCH /users/{id}/status` · `@RequirePermission('user:suspend')`

`ACTIVE ⇄ SUSPENDED`. `reason` is **required** by the schema.

In one transaction:

1. Load the target `FOR UPDATE`.
2. Reject if the actor is the target — nobody suspends themselves (parent §6.2's rule
   that a user cannot alter their own authority).
3. Reject a no-op transition.
4. Update `status`.
5. **Revoke every one of the target's refresh tokens.** Without this, a suspended user
   keeps a valid 30-day refresh token; the session guard stops them at once, but the
   moment they are reinstated the old token works again — and reinstatement is
   supposed to issue a fresh session, not resurrect a stale one.
6. Write the audit row with `before`/`after`.

---

## 5. Guards

### 5.1 Both guards are global, and `@Public()` is the opt-out

Registered as `APP_GUARD` providers: `SessionGuard`, then `PermissionsGuard`.

This is a fail-closed default. An endpoint added in Stage 7 by someone who forgets to
think about auth is protected *because they forgot*. The per-controller alternative
fails **open**, and parent §11's "server-side authorization on every protected
endpoint. No exceptions." is not a promise anyone keeps by remembering to decorate ~60
controllers.

`@Public()` goes on exactly six routes in Stage 2: health, the OpenAPI document,
signup, login, refresh, and logout. Any seventh is a decision someone has to defend.

### 5.2 `SessionGuard`

Reads `majlis_session`, verifies the JWT, loads the user by `sub` through
`host.tx`, rejects a missing user or `status !== 'ACTIVE'` with 401, and attaches the
loaded row to the request. `@Actor()` reads it back.

There is no code path by which a handler obtains a role from the request body, the
route params, or the token.

### 5.3 `PermissionsGuard` and the scope resolvers

`@RequirePermission('user:suspend')` defaults to platform scope.
`@RequirePermission('club:edit', { scope: 'club', from: 'params.clubId' })` names where
in the request the scope's *identifier* is found — the identifier only. The authority
attached to it is always loaded from the database.

Three resolvers, all built in this stage:

| Scope | What the guard loads |
|---|---|
| `platform` | `user.platform_role` |
| `club` | plus `ClubTeamAppointment` rows for (actor, clubId) with `status = 'ACTIVE'` |
| `event` | plus the event's `club_id`, that club's appointments, and `EventAssignment` rows for (actor, eventId) |

Only `ACTIVE` appointments count — parent §5.1: *"No permission is active until
`status = 'ACTIVE'`."*

The matrix in Stage 2 holds only what Stage 2 uses:

```ts
export const PERMISSIONS = {
  'user:list':    { platform: ['ADMIN'] },
  'user:suspend': { platform: ['ADMIN'] },
} satisfies Record<string, PermissionRule>;
```

Later stages add rows. They do not touch the guard.

**`ADMIN` is not an implicit superuser in `evaluate()`.** Every rule that admits an
Admin lists `ADMIN` explicitly. Parent §6.1's matrix has a row —
"Register for an event" — where the Admin column reads *"as student"*, not *override*.
A blanket `if (platformRole === 'ADMIN') return true` would silently grant the one
permission the matrix withholds, and no test of the other rows would notice.

A denial writes `outcome: 'DENIED'` and returns 403 (parent §10). The 404-instead-of-403
case, for endpoints where existence itself leaks, arrives with the first such endpoint;
no Stage 2 endpoint qualifies.

### 5.4 Out of scope for this stage

Parent §6.2's *"a suspended club freezes new activity"* concerns the **target's**
state, not the actor's authority. It belongs with the endpoints that create that
activity, from Stage 4 onward. `ActorFacts` is about the actor and stays that way.

---

## 6. The audit writer

```ts
audit.record({ action, entityType, entityId, outcome, reason?, before?, after? })
```

Writes through `host.tx`. Because `TransactionHost` resolves the ambient transaction
from `AsyncLocalStorage`, a writer called five frames below the service enlists in the
caller's transaction without being handed one — which is how guarantee #4 becomes
structural instead of a review checklist. The new ESLint boundary rule keeps it that
way.

`audit_log.request_id` is `NOT NULL`, and `ip` is wanted. Rather than growing every
service signature by two parameters, a **`RequestContext`** `AsyncLocalStorage` is
populated by middleware and read by the audit service.

A Nest `REQUEST`-scoped provider was considered and rejected: request scope propagates
up the injection graph, so one request-scoped audit service would make every service
that consumes it request-scoped too, re-instantiating the graph per request. The ALS
approach also mirrors `TransactionHost`, so the codebase has one pattern for ambient
context rather than two.

Stage 2 writes rows for: user suspension, reinstatement, platform-role change,
permission denial, and refresh-token reuse detection.

Not for successful logins. Parent §11's list is *"every approval, role change, scan,
issuance, revocation, and Admin override"* — login is absent, and a row per login
buries the rows that answer *"who attended, and who approved that"* (parent §1) under
routine traffic. The table is append-only by trigger, so that decision would be
permanent.

---

## 7. New dependencies

Every version must be **confirmed to exist on npm and to be older than 48 hours**
before pinning (`CLAUDE.md`; the Stage 1 plan contained versions that never existed).

| Package | Why | Note |
|---|---|---|
| `@node-rs/argon2` | argon2id hashing | Preferred over `argon2`: prebuilt napi binaries, no `node-gyp`, no native toolchain in the Vercel build |
| `@nestjs/jwt` | sign/verify the access token | Chosen over `jose` because this API is CommonJS (`moduleFormat = "cjs"`) and recent `jose` is ESM-only — the same class of trap that killed `@nestjs/cli` |
| `@nestjs/throttler` | rate limits | |
| `cookie-parser` + `@types/cookie-parser` | read cookies | Express 5 writes cookies natively via `res.cookie()`; reading still needs this |

Rate limits, as constants with a comment, tuned properly in Stage 12: login 5/min,
signup 3/hour, refresh 30/min, all per IP.

---

## 8. Testing

Parent §12 governs. Unit tests are pure; every endpoint is tested against real
PostgreSQL 18. Each test below names the broken implementation it exists to catch —
the Stage 1 retrospective found seven tests that passed against badly broken code, and
a test whose defect cannot be named is not testing anything.

### 8.1 The eight that matter most

| Test | The broken implementation it catches |
|---|---|
| Make an action fail *after* its audit row is written; assert **zero** audit rows | An audit writer using `PrismaService` instead of `host.tx` — the exact defect the transaction host exists to prevent |
| Reuse a rotated token; assert tokens issued **after** it are dead too | Revoking only the presented row, or only its ancestors |
| Suspend a user, then replay their **still-unexpired** access token | A guard that trusts the JWT and skips the user lookup — the 15-minute hole in guarantee #1 |
| Suspend a user; assert every refresh token is revoked | Suspension that only flips `status`, leaving a live 30-day credential |
| Log in with `Osama@uni.ac.ae` against an account stored as `osama@…` | A missing normalisation on the **lookup** side. Signup's omission fails loudly on the CHECK constraint; login's fails silently, as "wrong password" |
| Unknown email vs. wrong password: assert identical status **and** identical body | Distinct messages, i.e. an account-enumeration oracle |
| Non-admin `PATCH /users/{id}/status`: assert 403 **and** a `DENIED` audit row | A guard that denies correctly but records nothing |
| Two concurrent refreshes of one token | Reuse detection without `FOR UPDATE` — races into two live families |

### 8.2 Coverage beyond those

- **Unit, no database:** the full `evaluate()` matrix; cookie attribute construction
  (`Secure` off in development and on everywhere else); `SESSION_SECRET` rejection —
  short, absent, and equal to the example value under `NODE_ENV=production`.
- **Integration:** every endpoint in §4; `@Public()` routes reachable without a cookie
  **and** every non-public route rejected without one, enumerated from the route table
  so a new endpoint cannot quietly escape; logout idempotency; `PATCH /me` cannot change
  `email`, `status` or `platformRole` by sending them.
- **Authorization matrix:** every Stage 2 protected endpoint × each role that must not
  reach it.
- **Scope resolvers:** club and event resolution tested directly against inserted
  `ClubTeamAppointment` and `EventAssignment` rows, plus a test-only controller in the
  integration suite exercising the decorator end to end. No Stage 2 endpoint uses club
  or event scope, so without this the mechanism would ship untested and Stage 4 would
  inherit it unverified.
- **Discrimination check:** the appointment test must use at least two users and two
  clubs. A single-user fixture passes against a resolver that ignores its `userId`
  argument entirely — four such tests were the Stage 1 retrospective's headline defect.

### 8.3 Carried items closed in this stage

| # | Item |
|---|---|
| 4 | `test/factories.ts` — `uniq()`, `aUser()`, `aClub()`, deduplicated from the schema tests |
| 5 | Problem Details registered in the OpenAPI document — these are the first routes that declare error responses |
| 6 | Real argon2id in the seed, replacing `SEED-ONLY-NOT-A-REAL-HASH`; the seeded accounts become loginable with `Passw0rd!` as the README already promises |

Carried items 2 (`req.url` redaction) and 3 (CI unexercised) are untouched by this
stage and stay open.

---

## 9. Deviations from the parent spec

Approved during the Stage 2 brainstorm on 2026-09-11. To be copied into parent §13 on
completion.

1. **Passport is dropped.** Parent §3's ledger specifies *"NestJS-native — Passport,
   argon2id, httpOnly cookies…"*. The rest stands; Passport does not. There is exactly
   one strategy, the credential arrives in a cookie rather than a header so
   `passport-jwt` needs a custom extractor regardless, and its `validate()` must hit
   the database anyway — leaving a library, two dependencies, and a strategy class
   wrapping a forty-line guard. The guard is written and tested directly.

2. **Rate limiting is pulled forward from Stage 12.** Parent §13 assigns "rate limits"
   to Hardening, but parent §11 requires them on login and signup, and shipping a
   password endpoint with no brute-force limit and then building ten stages on top of
   it closes badly. Stage 12 still owns scan and `/verify/{code}` throttling, and the
   tuning.

3. **The permission mechanism is built in full, not as a skeleton.** Parent §13 says
   "permission guard skeleton". The `ClubTeamAppointment` and `EventAssignment` tables
   already exist, so the decorator, all three scope resolvers, and the DB derivation
   are built and tested now. Only the matrix stays minimal. The alternative designs the
   scope-resolution mechanism — the part most likely to be got wrong — under Stage 4's
   deadline, alongside Stage 4's own work.

---

## 10. Open item raised, not resolved

**There is no password reset and no email verification anywhere in the parent spec.**
§8's endpoint table has no `/auth/forgot-password`, §3 states that *"format and
uniqueness are the only checks"* on signup, and §5.1 has no `PasswordResetToken`
entity. A student who forgets their password therefore has no recovery path, and an
Admin has no way to provide one.

This is **not** built in Stage 2 — it is outside the stage's scope and needs the Resend
integration that Stage 10 owns. It is recorded here because it reads as an omission
rather than a decision, and it is cheaper to settle before Stage 10 sets the
notification patterns than after.
