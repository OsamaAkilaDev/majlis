/**
 * Field-level edit permissions — pure data plus one deciding function, the
 * same shape as PERMISSIONS in ./permissions.ts and for the same reason.
 *
 * The two gates answer different questions. `@RequirePermission('event:edit')`
 * decides *may you touch this resource at all*; the maps here decide *which
 * keys of the patch body*. Spec 6.1 gives Marketing "public fields" and CTO
 * "technical fields" on both clubs and events, which a route-level permission
 * cannot express.
 *
 * A key absent from a map is refused, so a field added to a patch schema
 * without a decision recorded here fails closed rather than falling through
 * to whoever holds the route permission.
 */

import { ForbiddenError } from '../common/problem/domain-error';
import type { ActorFacts, ClubRole } from './permissions';

/** Lead and Vice hold every field, so neither is ever listed in a bucket. */
const FULL_FIELD_ACCESS: ClubRole[] = ['LEAD', 'VICE_LEAD'];

/**
 * CTO holds nothing on a club: no column on Club is technical. That is why
 * `club:edit` gains MARKETING and not CTO — a CTO admitted to the route
 * would be refused by every field in the body.
 */
export const CLUB_FIELDS = {
  description: ['MARKETING'],
  category: ['MARKETING'],
  logoUploaded: ['MARKETING'],
  bannerUploaded: ['MARKETING'],
  departmentId: [],
  academicYear: [],
  membershipPolicy: [],
} as const satisfies Record<string, readonly ClubRole[]>;

/**
 * The last bucket — slug, the four timestamps and requiresClubMembership — is
 * empty on purpose: those decide when registration opens and what an existing
 * link points at, so they stay with Lead, Vice and Admin.
 */
export const EVENT_FIELDS = {
  title: ['MARKETING'],
  summary: ['MARKETING'],
  description: ['MARKETING'],
  eventType: ['MARKETING'],
  audience: ['MARKETING'],
  posterUploaded: ['MARKETING'],

  onlineUrl: ['CTO'],
  timezone: ['CTO'],
  attendancePolicy: ['CTO'],
  certificateEnabled: ['CTO'],
  certificateTitle: ['CTO'],
  certificateSignatory: ['CTO'],

  venue: ['OPERATIONS'],
  capacity: ['OPERATIONS'],
  waitlistEnabled: ['OPERATIONS'],
  checkInOpensAt: ['OPERATIONS'],
  checkInClosesAt: ['OPERATIONS'],

  slug: [],
  startsAt: [],
  endsAt: [],
  registrationOpensAt: [],
  registrationClosesAt: [],
  requiresClubMembership: [],
} as const satisfies Record<string, readonly ClubRole[]>;

export type FieldMap = Record<string, readonly ClubRole[]>;

/**
 * Throws naming the first refused key. `facts` is re-derived per request from
 * the database by the caller, exactly like the route-level guard does; a
 * client-supplied role never reaches here.
 *
 * ADMIN passes: spec 6.1 reads "override" in the Admin column of both edit
 * rows. Every Admin override is audited by the calling service.
 */
export function assertFieldsAllowed(
  body: object,
  map: FieldMap,
  facts: Pick<ActorFacts, 'platformRole' | 'clubRoles'>,
): void {
  if (facts.platformRole === 'ADMIN') return;
  if (facts.clubRoles.some((r) => FULL_FIELD_ACCESS.includes(r))) return;

  for (const key of Object.keys(body)) {
    const allowed = map[key];
    if (!allowed?.some((r) => facts.clubRoles.includes(r))) {
      throw new ForbiddenError(`You do not have permission to change ${key}.`);
    }
  }
}
