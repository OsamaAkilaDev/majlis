import { z } from 'zod';
import { clubRoleSchema, membershipStatusSchema } from '../common/enums';
import { cursorPageQuerySchema, cursorPageSchema } from '../common/pagination';

export { membershipStatusSchema };

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
  clubRoles: z.array(clubRoleSchema),
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
  clubRoles: z.array(clubRoleSchema),
});

export const myClubPageSchema = cursorPageSchema(myClubSchema);

// MembershipStatus type comes from ../common/enums via the barrel;
// redeclaring it here would collide as an ambiguous `export *` name.
export type DecideMembershipBody = z.infer<typeof decideMembershipBodySchema>;
export type AddMemberBody = z.infer<typeof addMemberBodySchema>;
export type Member = z.infer<typeof memberSchema>;
export type MemberPage = z.infer<typeof memberPageSchema>;
export type MemberListQuery = z.infer<typeof memberListQuerySchema>;
export type MyClub = z.infer<typeof myClubSchema>;
export type MyClubPage = z.infer<typeof myClubPageSchema>;
