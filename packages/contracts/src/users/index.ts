import { z } from 'zod';
import { emailSchema } from '../auth';
import { cursorPageQuerySchema, cursorPageSchema } from '../common/pagination';

/** Mirrors Prisma's `UserStatus`, declared locally: this package has no
 *  business depending on Prisma's runtime. */
export const userStatusSchema = z.enum(['ACTIVE', 'SUSPENDED']);

/**
 * Zod 4's `.url()` validates shape only and does NOT restrict scheme: it
 * accepts `javascript:alert(1)` and `data:text/html,x`. This value is stored
 * verbatim and echoed into an admin's browser, so the scheme is checked with
 * the platform's own parser.
 *
 * `https:` only, or the avatar loads as mixed content. The length bound stops
 * the column becoming free storage for a `data:`-length URL.
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

/** Deliberately excludes `clubRoles`, which is `sessionUserSchema`'s job:
 *  collapsing the two puts authorization facts in a profile-edit response. */
export const userProfileSchema = z.object({
  id: z.string(),
  email: z.string(),
  fullName: z.string(),
  avatarUrl: z.string().nullable(),
  platformRole: z.enum(['STUDENT', 'ADMIN']),
  status: userStatusSchema,
});

/**
 * `fullName` and `avatarUrl` are the only fields a user may change about
 * themselves. The service also picks them explicitly; this schema stripping
 * platformRole, status and email is a second layer, never a substitute.
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

/** `q` matches name OR address: an admin has whichever they were given, and a
 *  name-only search answers "no such user" for every address. */
export const userListQuerySchema = cursorPageQuerySchema.extend({
  status: userStatusSchema.optional(),
  q: z.string().trim().min(1).max(120).optional(),
});

/**
 * Deliberately narrower than `userListItemSchema`: a club Lead has no
 * business reading every account's platform role, status and creation date,
 * which is why `GET /users` stays Admin-only rather than being widened.
 */
export const userSearchItemSchema = z.object({
  id: z.string(),
  fullName: z.string(),
  email: z.string(),
});

/** Not a cursor page: paging a capped directory lookup would only be a way to
 *  walk the whole directory two characters at a time. */
export const userSearchResultSchema = z.object({ items: z.array(userSearchItemSchema) });

/** `q` is required, minimum two characters: that is what stops the route being
 *  a blank-query dump of every account. */
export const userSearchQuerySchema = z.object({
  q: z.string().trim().min(2).max(120),
});

/** `reason` is required: every admin override in spec 11's audited-action
 *  list carries one. */
export const patchUserStatusBodySchema = z.object({
  status: userStatusSchema,
  reason: z.string().trim().min(1).max(500),
});

/**
 * Every field optional and `reason` required, the reverse of `PATCH /me`:
 * this is one person acting on another's record. An empty patch is refused by
 * the service, not here, so the message can say what was missing.
 *
 * `email` reuses `emailSchema`. `user.email` has a
 * `CHECK (email = lower(email))`, so a second spelling of the rule here is a
 * 500 waiting for the first capital letter.
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
