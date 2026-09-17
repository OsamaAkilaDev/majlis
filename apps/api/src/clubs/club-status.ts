import type { ClubStatus } from '@majlis/contracts';
import { UnprocessableError } from '../common/problem/domain-error';

/**
 * Every status reaches every other. ARCHIVED was terminal until 2026-09-16,
 * when the product owner reversed it: an archive reached by misclick left no
 * route back, and the club's own screen could not say so.
 *
 * Kept as a table rather than collapsed into `from !== to`, which is all it
 * currently asserts. The table is the thing a future restriction is written
 * in, and a one-line predicate would have to be rebuilt into one first.
 */
const ALLOWED: Record<ClubStatus, ClubStatus[]> = {
  ACTIVE: ['SUSPENDED', 'ARCHIVED'],
  SUSPENDED: ['ACTIVE', 'ARCHIVED'],
  ARCHIVED: ['ACTIVE', 'SUSPENDED'],
};

/**
 * The only gate on a club status write. Every status change goes through
 * here; no handler assigns `status` directly.
 */
export function assertTransition(from: ClubStatus, to: ClubStatus): void {
  if (from === to) throw new UnprocessableError('That club is already in that state.');
  if (!ALLOWED[from].includes(to)) {
    throw new UnprocessableError(`A club cannot go from ${from} to ${to}.`);
  }
}

/** New memberships, new requests, and from Stage 5 new events. */
export function assertAcceptsNewActivity(status: ClubStatus): void {
  if (status !== 'ACTIVE') throw new UnprocessableError('That club is not accepting new activity.');
}

/**
 * Profile edits, team changes, and accepting an invitation (which grants
 * membership). Declining is exempt: it grants nothing, so an archived club
 * has no integrity stake in blocking it, and blocking it would only strand a
 * dead invitation in the invitee's list.
 */
export function assertAcceptsEdits(status: ClubStatus): void {
  if (status === 'ARCHIVED') throw new UnprocessableError('That club is archived.');
}
