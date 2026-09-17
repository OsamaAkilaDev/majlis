import { z } from 'zod';
import { emailSchema } from '../auth';
import { cursorPageQuerySchema, cursorPageSchema } from '../common/pagination';

/**
 * Mirrors Prisma's `UserStatus` enum (schema.prisma). Declared locally rather
 * than imported from the generated client, same reasoning as
 * `apps/api/src/auth/permissions.ts`'s local PlatformRole/ClubRole unions:
 * this package has no business depending on Prisma's runtime.
 */
export const userStatusSchema = z.enum(['ACTIVE', 'SUSPENDED']);

/**
 * Zod 4's `.url()` validates shape only: it does not restrict scheme, so it
 * accepts `javascript:alert(1)`, `data:text/html,x`, and `file:///etc/passwd`
 * just as happily as `https://...`. Stored verbatim and echoed by `GET /me`,
 * every auth response, and `PATCH /users/{id}/status` (i.e. into an admin's
 * browser for the student they just suspended). `new URL(v).protocol` is the
 * platform's own scheme parser, safer here than a hand-rolled regex.
 *
 * `https:` only: a `http:` avatar loads over plain transport into an
 * authenticated page, which every browser reports as mixed content and most
 * simply block. The length bound is what stops the column from being used as
 * free storage by a `data:`-length URL that happens to start with https.
 */
const httpsUrlSchema = z.string().trim().max(2048).refine(
  (v) => {
    try {
      return new URL(v).protocol === 'https:';
    } catch {
      return false;
    }
  },
  { message: 'must be an https:// URL' },
);

/**
 * The shape both `GET /me` and `PATCH /me` return, and what
 * `PATCH /users/{id}/status` returns for the user it just changed.
 * Deliberately excludes `clubRoles`: that's `sessionUserSchema`'s job (see
 * `../auth`), the one every auth response carries. Collapsing the two would
 * put authorization facts into a profile-edit response.
 */
export const userProfileSchema = z.object({
  id: z.string(),
  email: z.string(),
  fullName: z.string(),
  avatarUrl: z.string().nullable(),
  platformRole: z.enum(['STUDENT', 'ADMIN']),
  status: userStatusSchema,
});

/** Alias for the two routes that deal with the caller's own profile. */
export const meSchema = userProfileSchema;

/**
 * `PATCH /me`'s body. Deliberately narrow: `fullName` and `avatarUrl` are the
 * only two fields a user may change about themselves. The service picks
 * these two fields explicitly when writing to Prisma. This schema
 * stripping every other key (platformRole, status, email) is a second,
 * structural layer of the same guarantee, never a substitute for it.
 */
export const patchMeBodySchema = z.object({
  fullName: z.string().trim().min(1).max(120).optional(),
  avatarUrl: httpsUrlSchema.nullable().optional(),
});

/** One row of `GET /users`' admin listing. */
export const userListItemSchema = z.object({
  id: z.string(),
  email: z.string(),
  fullName: z.string(),
  platformRole: z.enum(['STUDENT', 'ADMIN']),
  status: userStatusSchema,
  createdAt: z.string(),
});

export const userListPageSchema = cursorPageSchema(userListItemSchema);

/**
 * `GET /users`' filters. `q` matches name or address, because an admin
 * looking a person up has whichever of the two they were given, and a
 * name-only search silently answers "no such user" for the other half.
 */
export const userListQuerySchema = cursorPageQuerySchema.extend({
  status: userStatusSchema.optional(),
  q: z.string().trim().min(1).max(120).optional(),
});

/**
 * One row of `GET /clubs/{clubId}/user-search`, the club-scoped directory
 * lookup an officer uses to pick a person to invite, add or assign.
 *
 * Deliberately narrower than `userListItemSchema`: a club Lead has no
 * business reading every account's platform role, status and creation date,
 * which is why `GET /users` stays Admin-only rather than being opened up.
 * Name and address are what it takes to tell two people apart.
 */
export const userSearchItemSchema = z.object({
  id: z.string(),
  fullName: z.string(),
  email: z.string(),
});

/**
 * Not a cursor page. The result is capped server-side and the officer
 * narrows it by typing, so paging it would only be a way to walk the whole
 * directory two characters at a time.
 */
export const userSearchResultSchema = z.object({ items: z.array(userSearchItemSchema) });

/**
 * `q` is required and at least two characters, which is what stops the
 * route from being a blank-query dump of every account.
 */
export const userSearchQuerySchema = z.object({
  q: z.string().trim().min(2).max(120),
});

/**
 * `PATCH /users/{id}/status`'s body. `reason` is required: every admin
 * override in spec §11's audited-action list carries one, and this is the
 * first of them Stage 2 implements.
 */
export const patchUserStatusBodySchema = z.object({
  status: userStatusSchema,
  reason: z.string().trim().min(1).max(500),
});

/**
 * `PATCH /users/{id}`'s body, the admin's edit of somebody else's account.
 *
 * Every field is optional and `reason` is required, the reverse of `PATCH
 * /me`: this is one person acting on another's record, which spec 11 audits
 * with a reason every time. An empty patch is refused by the service rather
 * than here, so the message can say what was missing.
 *
 * `email` reuses `emailSchema`, so an address written here is lowercased and
 * trimmed exactly as signup's is. `user.email` carries a
 * `CHECK (email = lower(email))`, and a second spelling of the rule here
 * would be a 500 waiting for the first capital letter.
 */
export const patchUserBodySchema = z.object({
  fullName: z.string().trim().min(1).max(120).optional(),
  email: emailSchema.optional(),
  avatarUrl: httpsUrlSchema.nullable().optional(),
  platformRole: z.enum(['STUDENT', 'ADMIN']).optional(),
  reason: z.string().trim().min(1).max(500),
});

export type UserStatus = z.infer<typeof userStatusSchema>;
export type PatchUserBody = z.infer<typeof patchUserBodySchema>;
export type UserProfile = z.infer<typeof userProfileSchema>;
export type Me = UserProfile;
export type PatchMeBody = z.infer<typeof patchMeBodySchema>;
export type UserListItem = z.infer<typeof userListItemSchema>;
export type UserListPage = z.infer<typeof userListPageSchema>;
export type UserListQuery = z.infer<typeof userListQuerySchema>;
export type UserSearchItem = z.infer<typeof userSearchItemSchema>;
export type UserSearchResult = z.infer<typeof userSearchResultSchema>;
export type UserSearchQuery = z.infer<typeof userSearchQuerySchema>;
export type PatchUserStatusBody = z.infer<typeof patchUserStatusBodySchema>;
