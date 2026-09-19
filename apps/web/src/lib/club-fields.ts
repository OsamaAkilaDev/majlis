import type { ClubRole, SessionUser } from '@majlis/contracts';

/**
 * A mirror of CLUB_FIELDS in `apps/api/src/auth/field-permissions.ts`, kept
 * honest by club-fields.test.ts, which parses that file and compares.
 *
 * Presentation only: it decides which fields the profile offers, so a
 * Marketing officer is not invited to type a change that will be refused, and
 * is not stopped from the two they are allowed. The server re-derives the same
 * decision from the database and is the protection.
 */

/** Lead and Vice hold every field, so neither is ever listed in a bucket. */
const FULL_FIELD_ACCESS: ClubRole[] = ['LEAD', 'VICE_LEAD'];

export const CLUB_FIELD_ROLES = {
  description: ['MARKETING'],
  category: ['MARKETING'],
  logoUploaded: ['MARKETING'],
  bannerUploaded: ['MARKETING'],
  departmentId: [],
  academicYear: [],
  membershipPolicy: [],
} as const satisfies Record<string, readonly ClubRole[]>;

export type ClubField = keyof typeof CLUB_FIELD_ROLES;

export function canEditClubField(
  field: ClubField,
  clubRoles: readonly ClubRole[],
  platformRole: SessionUser['platformRole'],
): boolean {
  if (platformRole === 'ADMIN') return true;
  if (clubRoles.some((r) => FULL_FIELD_ACCESS.includes(r))) return true;
  return CLUB_FIELD_ROLES[field].some((r) => clubRoles.includes(r));
}
