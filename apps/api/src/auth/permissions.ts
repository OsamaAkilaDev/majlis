/**
 * The permission matrix: pure data plus a deciding function. No I/O, no Nest.
 * The guard loads ActorFacts per request and calls `evaluate`.
 *
 * ADMIN is listed explicitly in every rule that admits it, and there is
 * deliberately NO `platformRole === 'ADMIN'` shortcut: spec 6.1's "Register
 * for an event" row reads "as student" in the Admin column, so a blanket
 * Admin-wins branch grants the one permission the matrix withholds.
 */

export type PlatformRole = 'STUDENT' | 'ADMIN';
export type ClubRole = 'LEAD' | 'VICE_LEAD' | 'MARKETING' | 'CTO' | 'OPERATIONS';
export type EventResponsibility = 'EVENT_LEAD' | 'OPERATIONS' | 'MARKETING';

// Declared locally so Prisma's runtime stays out of this module, then
// asserted against the generated types below. A role renamed in the schema
// would otherwise leave facts.clubRoles carrying the new string while
// PERMISSIONS lists the old one: `.includes()` returns false, an authorized
// officer is denied, and nothing fails to compile.
//
// `[T] extends [U]` on both sides, not the naked form: a bare conditional
// distributes over the union member-by-member and would pass even when the
// two differ. The tuples force a whole-set comparison.
import type {
  ClubRole as PrismaClubRole,
  EventResponsibility as PrismaEventResponsibility,
  PlatformRole as PrismaPlatformRole,
} from '../generated/prisma/enums';

type _SyncPlatformRole = [PlatformRole] extends [PrismaPlatformRole]
  ? [PrismaPlatformRole] extends [PlatformRole]
    ? true
    : never
  : never;
const _syncPlatformRole: _SyncPlatformRole = true;

type _SyncClubRole = [ClubRole] extends [PrismaClubRole]
  ? [PrismaClubRole] extends [ClubRole]
    ? true
    : never
  : never;
const _syncClubRole: _SyncClubRole = true;

type _SyncEventResponsibility = [EventResponsibility] extends [PrismaEventResponsibility]
  ? [PrismaEventResponsibility] extends [EventResponsibility]
    ? true
    : never
  : never;
const _syncEventResponsibility: _SyncEventResponsibility = true;

/**
 * `clubRoles` holds ONLY the actor's ACTIVE appointments in the club this
 * request is scoped to, never every club they hold a role in;
 * `eventResponsibilities` likewise. Reading it as "every club the actor
 * leads" is how a cross-club authorization bug gets written.
 */
export interface ActorFacts {
  userId: string;
  platformRole: PlatformRole;
  clubRoles: ClubRole[];
  eventResponsibilities: EventResponsibility[];
}

export interface PermissionRule {
  platform?: PlatformRole[];
  club?: ClubRole[];
  event?: EventResponsibility[];
}

export const PERMISSIONS = {
  'user:list': { platform: ['ADMIN'] },
  // Club-scoped, so it must ONLY be required on a route carrying a clubId: a
  // club rule cannot authorize a bare unscoped route. `user:list` is not
  // widened for this, because that route returns platform role, status and
  // creation date for every account in the university.
  'user:search': { platform: ['ADMIN'], club: ['LEAD', 'VICE_LEAD'] },
  'user:suspend': { platform: ['ADMIN'] },
  // Never club-scoped at any level: it writes `platformRole`, so a club
  // officer holding it could mint a platform admin out of a club role.
  'user:edit': { platform: ['ADMIN'] },
  'department:manage': { platform: ['ADMIN'] },
  'club:create': { platform: ['ADMIN'] },
  'club:status': { platform: ['ADMIN'] },
  'club:appoint-lead': { platform: ['ADMIN'] },
  'club:edit': { platform: ['ADMIN'], club: ['LEAD', 'VICE_LEAD', 'MARKETING'] },
  'club:team-manage': { platform: ['ADMIN'], club: ['LEAD'] },
  'membership:decide': { platform: ['ADMIN'], club: ['LEAD', 'VICE_LEAD', 'OPERATIONS'] },

  // Creation needs the whole object, including startsAt, which no field
  // bucket gives Marketing, CTO or Operations. Buckets govern editing only.
  'event:create': { platform: ['ADMIN'], club: ['LEAD', 'VICE_LEAD'] },
  // Every club role reaches the route; EVENT_FIELDS decides which keys.
  'event:edit': { platform: ['ADMIN'], club: ['LEAD', 'VICE_LEAD', 'MARKETING', 'CTO', 'OPERATIONS'] },
  'event:publish': { platform: ['ADMIN'], club: ['LEAD', 'VICE_LEAD'] },
  'event:cancel': { platform: ['ADMIN'], club: ['LEAD'] },
  'event:assign': { platform: ['ADMIN'], club: ['LEAD', 'VICE_LEAD'] },
  // Spec 6.1 gives Operations this only "for assigned event", which is an
  // EventAssignment and so belongs in the event column, not the club one.
  'registration:read': {
    platform: ['ADMIN'],
    club: ['LEAD', 'VICE_LEAD'],
    event: ['EVENT_LEAD', 'OPERATIONS'],
  },
  // Vice Lead is absent deliberately from both of these. The event column is
  // what lets an EventAssignment grant scan rights for one event without
  // making anyone a standing officer (spec 5.1).
  'attendance:scan': {
    platform: ['ADMIN'],
    club: ['LEAD', 'OPERATIONS'],
    event: ['EVENT_LEAD', 'OPERATIONS'],
  },
  // Club-scoped only: an assignment grants the right to scan a queue, not to
  // rewrite the record. The 48-hour window is enforced in the service, being
  // a property of the event's clock rather than of the actor.
  'attendance:correct': { platform: ['ADMIN'], club: ['LEAD', 'OPERATIONS'] },
  // No club role at all: a Lead cannot issue their own club's certificates,
  // which is what keeps one an institutional record.
  'certificate:manage': { platform: ['ADMIN'] },
  // Club-scoped: a club's own numbers are what its Lead and Vice already read
  // one screen at a time. /reports/overview is unscoped, so Admin alone.
  'report:read': { platform: ['ADMIN'], club: ['LEAD', 'VICE_LEAD'] },
  // Vice Lead is absent deliberately.
  'audit:read': { platform: ['ADMIN'], club: ['LEAD'] },
} as const satisfies Record<string, PermissionRule>;

export type Permission = keyof typeof PERMISSIONS;

// Indexed view of the same object, so an unrecognised key looks up to
// `undefined` rather than a type error: `evaluate` takes the narrow union at
// its boundary but must still handle a value cast through at runtime.
const RULES: Record<string, PermissionRule> = PERMISSIONS;

export function evaluate(permission: Permission, facts: ActorFacts): boolean {
  const rule = RULES[permission];
  // A typo in a @RequirePermission argument must fail closed.
  if (!rule) return false;
  return matches(rule, facts);
}

/** Exported so a rule not in PERMISSIONS can be exercised directly: that is
 *  how the "no implicit Admin superuser branch" test works. */
export function matches(rule: PermissionRule, facts: ActorFacts): boolean {
  if (rule.platform?.includes(facts.platformRole)) return true;
  if (rule.club?.some((r) => facts.clubRoles.includes(r))) return true;
  if (rule.event?.some((r) => facts.eventResponsibilities.includes(r))) return true;
  return false;
}
