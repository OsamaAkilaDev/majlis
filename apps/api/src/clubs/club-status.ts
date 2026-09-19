import type { ClubStatus } from '@majlis/contracts';
import { UnprocessableError } from '../common/problem/domain-error';

// Every status reaches every other, so this asserts no more than `from !== to`
// today. Kept as a table because that is what a future restriction is written in.
const ALLOWED: Record<ClubStatus, ClubStatus[]> = {
  ACTIVE: ['SUSPENDED', 'ARCHIVED'],
  SUSPENDED: ['ACTIVE', 'ARCHIVED'],
  ARCHIVED: ['ACTIVE', 'SUSPENDED'],
};

/** The only gate on a club status write. No handler assigns `status` directly. */
export function assertTransition(from: ClubStatus, to: ClubStatus): void {
  if (from === to) throw new UnprocessableError('That club is already in that state.');
  if (!ALLOWED[from].includes(to)) {
    throw new UnprocessableError(`A club cannot go from ${from} to ${to}.`);
  }
}

export function assertAcceptsNewActivity(status: ClubStatus): void {
  if (status !== 'ACTIVE') throw new UnprocessableError('That club is not accepting new activity.');
}

// Gates profile edits, team changes and accepting an invitation. Declining is
// deliberately exempt: it grants nothing, and blocking it would strand a dead
// invitation in the invitee's list.
export function assertAcceptsEdits(status: ClubStatus): void {
  if (status === 'ARCHIVED') throw new UnprocessableError('That club is archived.');
}
