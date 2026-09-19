import type { ClubStatus } from '@majlis/contracts';
import { NotFoundError } from '../common/problem/domain-error';
import type { Club } from '../generated/prisma/client';
import type { TransactionHost } from '../prisma/transaction.host';

/**
 * The club behind a `:clubId` path segment, or a 404. Every club-scoped write
 * starts here so not-found always precedes the status answer: a club that does
 * not exist must never be reported as archived. `assertStatus` stays the
 * caller's, because the rule differs per route.
 */
export async function loadClub(
  host: TransactionHost,
  clubId: string,
  assertStatus?: (status: ClubStatus) => void,
): Promise<Club> {
  const club = await host.tx.club.findUnique({ where: { id: clubId } });
  if (!club) throw new NotFoundError('No such club.');
  assertStatus?.(club.status);
  return club;
}
