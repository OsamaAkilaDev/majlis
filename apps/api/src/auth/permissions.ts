/**
 * The permission matrix — pure data plus a deciding function. No I/O, no
 * database, no Nest. The guard (PermissionsGuard) loads ActorFacts from the
 * database per request and calls `evaluate`; this module only decides.
 *
 * The matrix is data. Later stages add rows (e.g. `club:edit`); neither this
 * function nor the guard changes.
 *
 * ADMIN is listed explicitly in every rule that admits it. There is
 * deliberately no `if (platformRole === 'ADMIN') return true` shortcut —
 * spec §6.1's "Register for an event" row reads "as student" in the Admin
 * column, not "override". A blanket Admin-wins branch would silently grant
 * the one permission the matrix deliberately withholds. See the
 * "no implicit Admin superuser branch" test in permissions.spec.ts.
 */

export type PlatformRole = 'STUDENT' | 'ADMIN';
export type ClubRole = 'LEAD' | 'VICE_LEAD' | 'MARKETING' | 'CTO' | 'OPERATIONS';
export type EventResponsibility = 'EVENT_LEAD' | 'OPERATIONS' | 'MARKETING';

// The three unions above are declared locally, by literal, rather than
// imported as values from the generated Prisma client — that would drag
// Prisma's runtime into a module whose whole point is to have none. But a
// role RENAMED or REMOVED in the schema is dangerous if these silently
// drift: Task 8's guard reconciles ActorFacts against the real enum, so a
// renamed role would make facts.clubRoles carry the new string while
// PERMISSIONS still lists the old one — `.includes()` quietly returns
// false and an authorized officer is denied with no type error and no
// failing test, just a support ticket.
//
// So import ONLY the generated *types* (elided at compile time by
// `import type` — zero runtime, same as any other type-only import) and
// assert both unions describe the same set of strings. `[T] extends [U]`
// (not the naked `T extends U`) on both sides is deliberate: a bare
// conditional distributes over a union member-by-member, which would let
// this pass even when the two unions differ; wrapping each side in a
// tuple suppresses that distribution and forces a single, whole-set
// comparison.
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
export const _syncPlatformRole: _SyncPlatformRole = true;

type _SyncClubRole = [ClubRole] extends [PrismaClubRole]
  ? [PrismaClubRole] extends [ClubRole]
    ? true
    : never
  : never;
export const _syncClubRole: _SyncClubRole = true;

type _SyncEventResponsibility = [EventResponsibility] extends [PrismaEventResponsibility]
  ? [PrismaEventResponsibility] extends [EventResponsibility]
    ? true
    : never
  : never;
export const _syncEventResponsibility: _SyncEventResponsibility = true;

/**
 * Facts about the actor making a request, already scoped by the guard.
 *
 * `clubRoles` holds only the actor's ACTIVE appointments in the club that
 * the current request is scoped to — NOT every club they hold a role in.
 * `eventResponsibilities` is the same narrowing for the event in scope. A
 * reader who takes `clubRoles` to mean "every club the actor leads anywhere"
 * will write a cross-club authorization bug: the guard, not this module, is
 * what narrows to the scoped club/event before calling evaluate.
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
  'user:suspend': { platform: ['ADMIN'] },
  'department:manage': { platform: ['ADMIN'] },
  'club:create': { platform: ['ADMIN'] },
  'club:status': { platform: ['ADMIN'] },
  'club:appoint-lead': { platform: ['ADMIN'] },
  'club:edit': { platform: ['ADMIN'], club: ['LEAD', 'VICE_LEAD', 'MARKETING'] },
  'club:team-manage': { platform: ['ADMIN'], club: ['LEAD'] },
  'membership:decide': { platform: ['ADMIN'], club: ['LEAD', 'VICE_LEAD', 'OPERATIONS'] },

  // Creating an event needs the whole object, including startsAt, which no
  // field bucket gives Marketing, CTO or Operations. Field buckets govern
  // editing; creation stays with Lead, Vice and Admin.
  'event:create': { platform: ['ADMIN'], club: ['LEAD', 'VICE_LEAD'] },
  // Every club role reaches the edit route; EVENT_FIELDS decides which keys
  // of the body each of them may actually set.
  'event:edit': { platform: ['ADMIN'], club: ['LEAD', 'VICE_LEAD', 'MARKETING', 'CTO', 'OPERATIONS'] },
  'event:publish': { platform: ['ADMIN'], club: ['LEAD', 'VICE_LEAD'] },
  'event:cancel': { platform: ['ADMIN'], club: ['LEAD'] },
  'event:assign': { platform: ['ADMIN'], club: ['LEAD', 'VICE_LEAD'] },
  // Attendee personal data. Spec 6.1 gives club Operations this only 'for
  // assigned event', which is an EventAssignment row and so belongs in the
  // event column, not the club one. Marketing and CTO are excluded outright.
  'registration:read': {
    platform: ['ADMIN'],
    club: ['LEAD', 'VICE_LEAD'],
    event: ['EVENT_LEAD', 'OPERATIONS'],
  },
  // Spec 6.1's "Scan QR / check in" row ticks Lead and Operations only.
  // Vice Lead is absent deliberately, in both of these. The event column is
  // what makes an EventAssignment grant scan rights for one event without
  // making anyone a standing officer (spec 5.1).
  'attendance:scan': {
    platform: ['ADMIN'],
    club: ['LEAD', 'OPERATIONS'],
    event: ['EVENT_LEAD', 'OPERATIONS'],
  },
  // "Correct attendance" is club-scoped only: an assignment grants the right
  // to scan a queue, not to rewrite the record afterwards. The 48-hour
  // window and the Admin override past it are enforced in the service, not
  // here — they are a property of the event's clock, not of the actor.
  'attendance:correct': { platform: ['ADMIN'], club: ['LEAD', 'OPERATIONS'] },
  // Spec 6.1's "Issue / revoke certificate" row reads "Admin / system" and
  // ticks no club role at all. A Lead cannot issue their own club's
  // certificates, which is what keeps a certificate an institutional record
  // rather than a thing a club hands out.
  'certificate:manage': { platform: ['ADMIN'] },
} as const satisfies Record<string, PermissionRule>;

export type Permission = keyof typeof PERMISSIONS;

// A separately-typed indexed view of the same object, so an unrecognised
// string key looks up to `undefined` instead of a type error — `evaluate`
// takes the narrow `Permission` union at its own boundary (typo protection
// at compile time), but must still handle an unknown value cast through at
// runtime (e.g. `'x' as Permission`), which is exactly what the "denies an
// unknown permission" test does.
const RULES: Record<string, PermissionRule> = PERMISSIONS;

export function evaluate(permission: Permission, facts: ActorFacts): boolean {
  const rule = RULES[permission];
  // Unknown permission denies. A typo in a @RequirePermission argument must
  // fail closed, not fail open.
  if (!rule) return false;
  return matches(rule, facts);
}

/**
 * Exported so a rule that is not (yet) in PERMISSIONS can be exercised
 * directly — that's how the "no implicit Admin superuser branch" test
 * proves ADMIN isn't silently granted a permission it wasn't listed for.
 */
export function matches(rule: PermissionRule, facts: ActorFacts): boolean {
  if (rule.platform?.includes(facts.platformRole)) return true;
  if (rule.club?.some((r) => facts.clubRoles.includes(r))) return true;
  if (rule.event?.some((r) => facts.eventResponsibilities.includes(r))) return true;
  return false;
}
