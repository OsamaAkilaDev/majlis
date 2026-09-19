import { evaluate, type Permission, type PlatformRole } from '../auth/permissions';
import { resolveClubFacts } from '../auth/permissions.guard';
import { ForbiddenError, NotFoundError } from '../common/problem/domain-error';
import type { TransactionHost } from '../prisma/transaction.host';

export interface RosterReader {
  id: string;
  platformRole: PlatformRole;
}

/**
 * Who may read a club's member and team lists. An ACTIVE club's are open to any
 * signed-in user; a SUSPENDED or ARCHIVED club's stay with its own officers and
 * Admin, or enumerating suspended clubs hands any student every member's name.
 * Email addresses are a separate, narrower gate: see `canReadRosterEmail`.
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
 * Whether this reader may see the email addresses on a club's roster. The lists
 * are open, but an address is directory data that `user:search` withholds from
 * anyone who does not lead a club, so the same officer bar applies here:
 * `membership:decide` for members, `club:team-manage` for the team. Re-derived
 * from the database, since the route guard requires no permission on these two.
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
