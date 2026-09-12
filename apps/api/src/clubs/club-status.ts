import type { ClubStatus } from '@majlis/contracts';
import { UnprocessableError } from '../common/problem/domain-error';

/** ARCHIVED is terminal and appears in no value list. */
const ALLOWED: Record<ClubStatus, ClubStatus[]> = {
  ACTIVE: ['SUSPENDED', 'ARCHIVED'],
  SUSPENDED: ['ACTIVE', 'ARCHIVED'],
  ARCHIVED: [],
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

/** Profile edits, team changes, and membership decisions already in flight. */
export function assertAcceptsEdits(status: ClubStatus): void {
  if (status === 'ARCHIVED') throw new UnprocessableError('That club is archived.');
}
