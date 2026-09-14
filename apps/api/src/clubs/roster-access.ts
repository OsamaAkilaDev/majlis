import { evaluate, type Permission, type PlatformRole } from '../auth/permissions';
import { resolveClubFacts } from '../auth/permissions.guard';
import { ForbiddenError, NotFoundError } from '../common/problem/domain-error';
import type { TransactionHost } from '../prisma/transaction.host';

/** Only what the roster gates read off the signed-in user. */
export interface RosterReader {
  id: string;
  platformRole: PlatformRole;
}

/**
 * Who may read a club's member and team lists at all. An ACTIVE club's lists
 * are open to any signed-in user, per the stage design. A SUSPENDED or
 * ARCHIVED club's are not: they stay visible to its own officers and to
 * Admin only. Without this, enumerating suspended clubs and reading their
 * rosters hands any student every member's name.
 *
 * The email addresses are a separate, narrower gate: see `canReadRosterEmail`.
 */
export async function assertCanReadRoster(
  host: TransactionHost,
  actor: RosterReader,
  clubId: string,
): Promise<void> {
  const club = await host.tx.club.findUnique({ where: { id: clubId }, select: { status: true } });
  if (!club) throw new NotFoundError('No such club.');
  if (club.status === 'ACTIVE') return;
  if (actor.platformRole === 'ADMIN') return;

  const appointment = await host.tx.clubTeamAppointment.findFirst({
    where: { clubId, userId: actor.id, status: 'ACTIVE' },
    select: { id: true },
  });
  if (!appointment) throw new ForbiddenError('You do not have permission to do that.');
}

/**
 * Whether this reader may see the email addresses on a club's roster.
 *
 * The lists themselves are open (above), but an address is directory data
 * that `user:search` already withholds from everyone who does not lead a
 * club. Its own rule exists because "this route returns a name and an
 * address, and only to somebody who already leads a club". A roster that
 * hands every member's address to any signed-in user makes that rule
 * decorative, so the same club-officer bar applies here: `membership:decide`
 * for the member list, `club:team-manage` for the team list. Admin clears
 * both through the platform half of each rule.
 *
 * Re-derived from the database rather than carried over from the route
 * guard, which required no permission on these two routes at all.
 */
export async function canReadRosterEmail(
  host: TransactionHost,
  actor: RosterReader,
  clubId: string,
  permission: Permission,
): Promise<boolean> {
  const { clubRoles } = await resolveClubFacts(host, actor.id, clubId);
  return evaluate(permission, {
    userId: actor.id,
    platformRole: actor.platformRole,
    clubRoles,
    eventResponsibilities: [],
  });
}
