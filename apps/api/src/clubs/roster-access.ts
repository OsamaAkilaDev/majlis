import { ForbiddenError, NotFoundError } from '../common/problem/domain-error';
import type { TransactionHost } from '../prisma/transaction.host';

/**
 * Who may read a club's member and team lists. Both carry full names and
 * email addresses, so this is the gate on that PII.
 *
 * An ACTIVE club's lists are open to any signed-in user, per the stage
 * design. A SUSPENDED or ARCHIVED club's are not: they stay visible to its
 * own officers and to Admin only. Without this, enumerating suspended clubs
 * and reading their rosters hands any student every member's email.
 */
export async function assertCanReadRoster(
  host: TransactionHost,
  actor: { id: string; platformRole: string },
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
