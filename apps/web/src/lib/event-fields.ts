import type { ClubRole, SessionUser } from '@majlis/contracts';

/**
 * A mirror of EVENT_FIELDS in `apps/api/src/auth/field-permissions.ts`, kept
 * honest by event-fields.test.ts, which parses that file and compares.
 *
 * This is presentation only: it decides which inputs the editor disables so an
 * officer is not invited to type a change that will be refused. The server
 * re-derives the same decision from the database and is the protection.
 */

/** Lead and Vice hold every field, so neither is ever listed in a bucket. */
const FULL_FIELD_ACCESS: ClubRole[] = ['LEAD', 'VICE_LEAD'];

export const EVENT_FIELD_ROLES = {
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

  slug: [],
  startsAt: [],
  endsAt: [],
  registrationOpensAt: [],
  registrationClosesAt: [],
  requiresClubMembership: [],
} as const satisfies Record<string, readonly ClubRole[]>;

export type EventField = keyof typeof EVENT_FIELD_ROLES;

export function canEditEventField(
  field: EventField,
  clubRoles: readonly ClubRole[],
  platformRole: SessionUser['platformRole'],
): boolean {
  if (platformRole === 'ADMIN') return true;
  if (clubRoles.some((r) => FULL_FIELD_ACCESS.includes(r))) return true;
  return EVENT_FIELD_ROLES[field].some((r) => clubRoles.includes(r));
}
