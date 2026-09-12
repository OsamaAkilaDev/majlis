# Stage 4 design: clubs, team and membership

**Status:** proposed, awaiting review
**Authority:** subordinate to [`2026-09-10-majlis-design.md`](2026-09-10-majlis-design.md). Where this document and the main spec disagree, §2 below records the deviation and the reason. Everything not mentioned here follows the main spec unchanged.

---

## 1. Scope

Departments. Club creation, editing and the status machine. A shared image upload pipeline. Lead appointment. Team invitations and acceptance. The four membership policies, requests and decisions, member lists, and leaving.

Every screen these features need, across all three shells.

Out of scope: events, registration, notifications of any kind, email, and field-level edit permissions (§8.2).

---

## 2. Deviations from the main spec

| # | Main spec says | Stage 4 does | Why |
|---|---|---|---|
| D1 | §8: `POST /team-invitations/{token}/accept` | `POST /appointments/{id}/accept` | Owner decision: invitations appear in an in-app pending list, with no link and no token anywhere. There is no token to put in a URL. |
| D2 | §7.2: `INVITE_ONLY` means "only a valid invitation admits" | An officer adds the member directly | Owner decision. Avoids a second token flow and a `MembershipStatus.INVITED` value the enum does not have, which would need a migration. |
| D3 | §8: `POST /clubs/{id}/logo-upload-url` | A shared upload module serving every resource image | Owner decision: one bucket, `majlis-storage`, organised into folders, with WebP conversion and size validation for all image uploads. |
| D4 | §6.1: Marketing edits public fields, CTO edits technical fields | `club:edit` remains Lead and Vice only | Owner decision. Field-level permissions are a mechanism the guard does not have, and Stage 5's event editing needs the identical mechanism. Building it once, in Stage 5, is cheaper than building it twice. Recorded as carried forward. |

D1 leaves `ClubTeamAppointment.invitationTokenHash` and `invitationExpiresAt` in the schema. `invitationExpiresAt` is used (§7.3). `invitationTokenHash` is written by nothing in Stage 4 and stays null until Stage 8 adds email.

---

## 3. Storage and the image pipeline

### 3.1 Bucket

One public bucket, `majlis-storage`, in the Supabase project at `SUPABASE_STORAGE_URL`.

Two settings are configured in the Supabase dashboard, not in code, and they are the enforcement layer:

| Setting | Value |
|---|---|
| Restrict file upload size | 2 MB |
| Allowed MIME types | `image/webp` |

These bind every upload, including one made by a client that skips our UI and PUTs directly at a signed URL. Application-side checks are defence in depth on top of them, never the primary control.

### 3.2 Paths

Server-derived, always. The path is built from an id the request was already authorized against, never from a client-supplied string. A client that can influence the path can write into another club's folder.

```
clubs/<clubId>/logo.webp
clubs/<clubId>/banner.webp
```

Reserved for later stages, defined now so the convention is settled:

```
events/<eventId>/poster.webp
users/<userId>/avatar.webp
site/<name>.webp
```

Names are deterministic, so replacing an image overwrites in place and there is nothing to garbage collect. The stored URL carries a version query so a replacement is a distinct URL and no CDN or browser serves the old bytes:

```
https://<host>/storage/v1/object/public/majlis-storage/clubs/<id>/logo.webp?v=<epoch-ms>
```

`Club.logoUrl` and `Club.bannerUrl` store that full string, version included.

### 3.3 Per-kind limits

| Kind | Fit inside | Stored cap |
|---|---|---|
| Club logo | 512 x 512, square | 256 KB |
| Club banner | 1600 x 600 | 512 KB |

Reserved: event poster 1200 x 630 at 512 KB, user avatar 256 x 256 square at 128 KB.

### 3.4 Client conversion

In the browser, before any network call:

1. Reject a source file over 10 MB without decoding it, so a large file cannot exhaust memory before it is refused.
2. Decode with `createImageBitmap`, draw to a canvas scaled to fit the kind's box while preserving aspect ratio. Square kinds centre-crop.
3. Encode with `canvas.toBlob(..., 'image/webp', 0.82)`.
4. If the result exceeds the kind's cap, re-encode at 0.7, then 0.6. If it is still over, refuse.

No image library. `createImageBitmap`, canvas and `toBlob('image/webp')` are available in every browser the project targets.

### 3.5 Server module

`apps/api/src/storage/`, exposing two operations:

```ts
createSignedUploadUrl(path: string): Promise<{ url: string; token: string }>
statObject(path: string): Promise<{ size: number; contentType: string } | null>
```

Implemented with `fetch` against Supabase's Storage REST API, authenticated with `SUPABASE_SERVICE_ROLE_KEY`. No SDK: `@supabase/supabase-js` carries auth, realtime and postgrest clients for what is two HTTP calls here.

**The first implementation step is to verify the exact request and response shape of both calls against the live Supabase API and record it in the task's report.** Wire formats written from memory are how plan defects reach production in this project.

The service role key is read through `env.schema.ts` and never leaves the API process. It is added to `LOG_REDACT_PATHS`.

### 3.6 Verification before the URL is stored

A signed upload URL means our API never sees the bytes. So no handler writes a `logoUrl` or `bannerUrl` it has not verified:

1. `statObject(path)` returns null: 422, the upload did not happen.
2. `contentType !== 'image/webp'`: 422.
3. `size` over the kind's cap: 422.
4. Only then is the column written, inside the same transaction as the audit row.

---

## 4. Departments

`GET /departments` (cursor-paginated), `POST /departments`, `PATCH /departments/{id}`, `DELETE /departments/{id}`. Admin only for the three writes; any authenticated user may list, because the club creation and browse screens both need it.

`name` and `code` are unique. `code` is uppercase, 2 to 10 characters, letters and digits.

`Club.departmentId` has `onDelete: Restrict`, so deleting a department that still has clubs raises a foreign key violation. The service maps it to `ConflictError` and 409. An integration test asserts this by attempting the delete with a club attached, not by counting rows.

---

## 5. Clubs

### 5.1 Creation, and the ordering problem

`Club.logoUrl` is NOT NULL. A signed upload URL needs a path. The path needs a club id. The club does not exist yet.

Resolved by having the server mint the id before the upload:

1. `POST /clubs/logo-upload-url` (Admin). Server generates a UUID v7, returns `{ clubId, path, signedUrl, token }`.
2. Browser converts and PUTs to the signed URL.
3. `POST /clubs` carries that same `clubId` in the body along with the rest of the profile.
4. Server verifies per §3.6 that an object exists at exactly `clubs/<clubId>/logo.webp`, then inserts the row with that id.

An abandoned upload leaves an orphan file of a few hundred KB. That is cheaper than a staging prefix with a move step, and far cheaper than making the column nullable to work around a sequencing issue.

Step 3 does not trust the body's `clubId` for authorization. The permission is `club:create`, which is Admin-only and unscoped, so there is nothing for a forged id to escalate to. A `clubId` that collides with an existing club fails on the primary key and returns 409.

### 5.2 Fields

`name` (unique), `slug` (unique, derived), `departmentId`, `description`, `category`, `academicYear`, `logoUrl`, `bannerUrl` (optional), `membershipPolicy`, `status`.

`slug` is derived from `name`: lowercased, non-alphanumerics collapsed to single hyphens, trimmed. On collision a numeric suffix is appended (`-2`, `-3`). The slug is never editable after creation, because it is the public identifier and rewriting it breaks every link that exists.

`academicYear` matches `^\d{4}/\d{4}$` with the second year exactly one greater than the first.

### 5.3 Status machine

```
ACTIVE ⇄ SUSPENDED
   ↓         ↓
   └──→ ARCHIVED  (terminal)
```

`PATCH /clubs/{id}/status`, Admin only, body `{ status, reason }`. The reason is required and is stored on the audit row, per §6.1 of the main spec.

One transition function owns every status write. No handler assigns `status` directly. An illegal transition (anything out of `ARCHIVED`) raises `UnprocessableError`.

Effects, per main spec §6.2:

| State | Effect |
|---|---|
| `SUSPENDED` | No new memberships, no new membership requests. Existing records and history stay fully readable. Officers keep their appointments and can still edit the profile. |
| `ARCHIVED` | No new activity of any kind, including profile edits. Everything remains readable. |

These are enforced in the service, not the UI. An integration test calls each blocked endpoint against a suspended and an archived club.

### 5.4 Lead appointment

`POST /clubs/{id}/lead`, Admin only, body `{ userId }`. Creates a `ClubTeamAppointment` with `role = LEAD`, `status = INVITED`.

The partial unique index `club_team_appointment_one_active_lead` on `(club_id) WHERE role = 'LEAD' AND status = 'ACTIVE'` already exists in migration `20260910201736_organisation`. It constrains ACTIVE rows only, so a club may hold one ACTIVE Lead and any number of INVITED candidates at once. Appointing a second Lead while one is already ACTIVE therefore fails at acceptance, not at invitation.

That is the correct behaviour but it is surprising, so it gets an explicit integration test: invite two Leads, accept both, assert the second acceptance returns 409 and leaves the first ACTIVE.

---

## 6. Team appointments

### 6.1 Invitation

`POST /clubs/{id}/team`, permission `club:team-manage` (Lead, or Admin as override). Body `{ userId, role }`. Creates `status = INVITED` with `invitationExpiresAt = now + 14 days`.

A user cannot invite themselves (main spec §6.2). Inviting a user who already holds an ACTIVE appointment in that club for that role returns 409.

**`INVITED` grants nothing.** `PermissionsGuard` already narrows to `status = 'ACTIVE'` appointments and does not change in this stage.

### 6.2 Acceptance

`GET /me/invitations` lists the caller's own `INVITED` appointments that have not expired.

`POST /appointments/{id}/accept` and `POST /appointments/{id}/decline`, callable only by the appointment's own `userId`. Anyone else gets 404, not 403, so the endpoint does not confirm that an appointment id exists.

Accepting, in one transaction:
1. Set `status = ACTIVE`, `acceptedAt = now`, `termStart = now`.
2. Create a `ClubMembership` with `status = ACTIVE` if the user has no open membership in that club (main spec §7.2: a team member automatically receives ordinary membership).
3. Write the audit row.

Declining sets `status = DECLINED`. Neither is reversible; a new invitation is a new row.

### 6.3 Expiry

Evaluated lazily on read, never by a job. An appointment with `status = INVITED` and `invitationExpiresAt < now` is treated as expired: it is excluded from `GET /me/invitations`, and accepting it returns 422. The row is flipped to `EXPIRED` opportunistically when an accept is attempted against it.

This matches the main spec's "no queue, background work is plain code, the lifecycle is lazy" decision.

### 6.4 Ending an appointment

`DELETE /appointments/{id}`, permission `club:team-manage`. Sets `status = ENDED`, `endedAt`, `endedReason`. Rows are never deleted, so history survives.

A user cannot end their own Lead appointment (main spec §6.2). The ordinary `ClubMembership` created at acceptance is not touched: losing an officer role does not remove someone from the club.

---

## 7. Membership

### 7.1 Joining

`POST /clubs/{id}/membership-requests`, any authenticated user, for themselves only.

| Policy | Result |
|---|---|
| `OPEN` | `ACTIVE` immediately |
| `APPROVAL_REQUIRED` | `PENDING` |
| `INVITE_ONLY` | 422 |
| `CLOSED` | 422 |

Refused for a `SUSPENDED` or `ARCHIVED` club regardless of policy.

The partial unique index `club_membership_one_open_per_user` on `(club_id, user_id) WHERE status IN ('PENDING','ACTIVE')` already exists. A second request while one is open returns 409. A user whose status is `LEFT`, `REJECTED` or `REMOVED` may request again, because those values are outside the index predicate.

### 7.2 Officer-added members

`POST /clubs/{id}/members`, permission `membership:decide`. Body `{ userId }`. Creates an `ACTIVE` membership directly. This is the only route in under `INVITE_ONLY`, and it works under `OPEN` and `APPROVAL_REQUIRED` too.

**Corrected during Stage 4.** This route refuses under `CLOSED`. An earlier draft said it worked under every policy, which contradicts the main spec's "no new memberships" and would have made `CLOSED` and `INVITE_ONLY` behave identically, leaving one of the four policies meaningless.

### 7.3 Decisions

`PATCH /membership-requests/{id}`, permission `membership:decide` (Lead, Vice, Operations, or Admin as override). Body `{ status: 'ACTIVE' | 'REJECTED', reason? }`. Sets `decidedAt`, `decidedById`, `decisionReason`.

A user cannot decide their own request. Enforced in the service and tested by having an Operations officer request membership of their own club and attempt to approve it.

Only a `PENDING` row can be decided. Anything else returns 422.

### 7.4 Leaving and removal

`DELETE /clubs/{id}/membership` sets the caller's own membership to `LEFT`.
`DELETE /clubs/{id}/members/{userId}`, permission `membership:decide`, sets it to `REMOVED`.

Neither deletes anything. Historic registrations, attendance and certificates are untouched, per main spec §7.2.

Leaving does not end an appointment. An officer who leaves the club keeps their role until it is ended explicitly, which is a state worth noticing, so `GET /clubs/{id}/team` shows it.

### 7.5 Lists

`GET /clubs/{id}/members` and `GET /clubs/{id}/team`, both cursor-paginated, both filterable by status. Visible to any authenticated user for an `ACTIVE` club; a suspended or archived club's lists stay visible to its officers and to Admin.

No unbounded list anywhere, per main spec §8.

---

## 8. Permissions

### 8.1 New rows

`PERMISSIONS` is pure data and gains rows only. Neither `evaluate` nor `PermissionsGuard` changes.

```ts
'department:manage':  { platform: ['ADMIN'] },
'club:create':        { platform: ['ADMIN'] },
'club:status':        { platform: ['ADMIN'] },
'club:appoint-lead':  { platform: ['ADMIN'] },
'club:team-manage':   { platform: ['ADMIN'], club: ['LEAD'] },
'membership:decide':  { platform: ['ADMIN'], club: ['LEAD', 'VICE_LEAD', 'OPERATIONS'] },
```

`club:edit` already exists as `{ platform: ['ADMIN'], club: ['LEAD', 'VICE_LEAD'] }` and is unchanged.

### 8.2 Carried forward to Stage 5

Main spec §6.1 gives Marketing edit rights over public fields and CTO over technical fields. Stage 4 does not implement this. Stage 5 needs the identical mechanism for events, and building a field allowlist twice is worse than building it once.

Until then, Marketing and CTO hold appointments that grant no edit permission. The team screen shows their role without implying an ability they do not have.

### 8.3 Admin override

Every Admin action on a club that a club officer would otherwise own requires a reason and writes an audit row in the same transaction, per main spec §6.1. That is `club:status`, `club:appoint-lead`, and `club:team-manage` or `membership:decide` exercised by an Admin who holds no appointment in the club.

---

## 9. API surface

All under `/api/v1`. Cursor pagination on every list.

| Method | Path | Permission |
|---|---|---|
| GET | `/departments` | authenticated |
| POST | `/departments` | `department:manage` |
| PATCH | `/departments/{id}` | `department:manage` |
| DELETE | `/departments/{id}` | `department:manage` |
| GET | `/clubs` | authenticated |
| POST | `/clubs/logo-upload-url` | `club:create` |
| POST | `/clubs` | `club:create` |
| GET | `/clubs/{id}` | authenticated |
| PATCH | `/clubs/{id}` | `club:edit` |
| POST | `/clubs/{id}/logo-upload-url` | `club:edit` |
| POST | `/clubs/{id}/banner-upload-url` | `club:edit` |
| PATCH | `/clubs/{id}/status` | `club:status` |
| POST | `/clubs/{id}/lead` | `club:appoint-lead` |
| GET | `/clubs/{id}/team` | authenticated |
| POST | `/clubs/{id}/team` | `club:team-manage` |
| DELETE | `/appointments/{id}` | `club:team-manage` |
| GET | `/me/invitations` | self |
| POST | `/appointments/{id}/accept` | self |
| POST | `/appointments/{id}/decline` | self |
| GET | `/clubs/{id}/members` | authenticated |
| POST | `/clubs/{id}/members` | `membership:decide` |
| POST | `/clubs/{id}/membership-requests` | self |
| PATCH | `/membership-requests/{id}` | `membership:decide` |
| DELETE | `/clubs/{id}/membership` | self |
| DELETE | `/clubs/{id}/members/{userId}` | `membership:decide` |
| GET | `/me/clubs` | self |

Zod schemas in `packages/contracts` are the source of truth; OpenAPI is generated from them.

---

## 10. Invariants

Already in the database, from migration `20260910201736_organisation`. Stage 4 adds no new index but must prove each one discriminates:

| Invariant | Test that fails without it |
|---|---|
| One ACTIVE Lead per club | Invite two Leads, accept both, assert the second returns 409 and the first stays ACTIVE. Two distinct users, not one. |
| One open membership per (user, club) | Two concurrent `POST /membership-requests` for the same user and club under `OPEN`, assert exactly one `ACTIVE` row exists. |
| Department deletion restricted | Delete a department holding a club, assert 409 and that the club still exists. |

The concurrency test uses two real requests, not two sequential calls, because a sequential pair passes against an implementation that checks-then-inserts without the index.

---

## 11. Screens

No explanatory copy anywhere. `EmptyState` and `Field` have no `description` prop and none is added.

**Admin console**
- Departments: list, create, edit, delete, with the 409 surfaced as a real refusal rather than a generic failure.
- Clubs: list with department and status filters; create, including logo upload; detail.
- Club status control: suspend, reactivate, archive, each with the required reason.
- Appoint Lead: user search, invite, and the pending invitation shown until it is answered.

**Officer console**
- Club profile edit, for Lead and Vice.
- Logo and banner replacement.
- Membership policy control.
- Team: list with status, invite an officer, end an appointment.
- Membership requests queue: approve or reject with an optional reason.
- Members list with removal.

**Student shell**
- Browse and search clubs.
- Club detail, where the join control reflects the policy: join, request to join, or an explicit refusal for `INVITE_ONLY` and `CLOSED`.
- My clubs, with leaving.
- My invitations: pending team invitations, accept or decline.

The upload control shows conversion progress and the refusal reason when a file cannot be brought under its cap, since that is a real outcome the user must be able to act on.

---

## 12. Testing

Integration tests for every endpoint, covering the authorized path, the refusal for each role that must not reach it, and the state-machine refusals for suspended and archived clubs.

Before trusting any test, name the broken implementation it catches. The three in §10 exist specifically because they fail against an implementation that relies on application-level checks.

A security review runs before the stage merges: this stage introduces a service role key, signed upload URLs, and six permission rows.

The axe suite gains the new screens in both themes at both viewports. If axe reports a violation, the markup is fixed; the tag list is never narrowed.

---

## 13. Open items

- `invitationTokenHash` is written by nothing and stays null until Stage 8.
- Orphaned uploads from abandoned club creations accumulate. No sweep in Stage 4.
- Field-level edit permissions for Marketing and CTO, deferred to Stage 5 (§8.2).
- `req.url` is logged unredacted (handoff gap 3). The in-app invitation flow removes the token-in-URL risk that made it urgent, but it is closed in this stage regardless.
