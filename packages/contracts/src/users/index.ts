import { z } from 'zod';
import { cursorPageSchema } from '../common/pagination';

/**
 * Mirrors Prisma's `UserStatus` enum (schema.prisma). Declared locally rather
 * than imported from the generated client — same reasoning as
 * `apps/api/src/auth/permissions.ts`'s local PlatformRole/ClubRole unions:
 * this package has no business depending on Prisma's runtime.
 */
export const userStatusSchema = z.enum(['ACTIVE', 'SUSPENDED']);

/**
 * The shape both `GET /me` and `PATCH /me` return, and what
 * `PATCH /users/{id}/status` returns for the user it just changed.
 * Deliberately excludes `clubRoles` — that's `sessionUserSchema`'s job (see
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
 * these two fields explicitly when writing to Prisma — this schema
 * stripping every other key (platformRole, status, email) is a second,
 * structural layer of the same guarantee, never a substitute for it.
 */
export const patchMeBodySchema = z.object({
  fullName: z.string().trim().min(1).max(120).optional(),
  avatarUrl: z.string().trim().url().nullable().optional(),
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
 * `PATCH /users/{id}/status`'s body. `reason` is required — every admin
 * override in spec §11's audited-action list carries one, and this is the
 * first of them Stage 2 implements.
 */
export const patchUserStatusBodySchema = z.object({
  status: userStatusSchema,
  reason: z.string().trim().min(1).max(500),
});

export type UserStatus = z.infer<typeof userStatusSchema>;
export type UserProfile = z.infer<typeof userProfileSchema>;
export type Me = UserProfile;
export type PatchMeBody = z.infer<typeof patchMeBodySchema>;
export type UserListItem = z.infer<typeof userListItemSchema>;
export type UserListPage = z.infer<typeof userListPageSchema>;
export type PatchUserStatusBody = z.infer<typeof patchUserStatusBodySchema>;
