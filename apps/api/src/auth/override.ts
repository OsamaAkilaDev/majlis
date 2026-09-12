import type { TransactionHost } from '../prisma/transaction.host';
import { overrideReasonFor } from './field-permissions';
import type { PlatformRole } from './permissions';
import { resolveClubFacts } from './permissions.guard';

/**
 * Spec 6.1's override reason for an action scoped to one club: required when
 * the actor is a platform Admin holding no ACTIVE role in that club, and
 * undefined when they are acting in a club capacity and so not overriding.
 *
 * The club roles are re-derived from the database here, never carried over
 * from the route guard: this is a second authorization decision and trusts
 * nothing the first one left on the request.
 */
export async function clubOverrideReason(
  host: TransactionHost,
  actor: { id: string; platformRole: PlatformRole },
  clubId: string,
  reason: string | undefined,
): Promise<string | undefined> {
  const { clubRoles } = await resolveClubFacts(host, actor.id, clubId);
  return overrideReasonFor({ platformRole: actor.platformRole, clubRoles }, reason);
}
