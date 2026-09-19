import type { ClubStatus, EventStatus } from '@majlis/contracts';
import { assertAcceptsEdits as assertClubAcceptsEdits } from '../clubs/club-status';
import { UnprocessableError } from '../common/problem/domain-error';

// The linear part of the lifecycle (spec 7.3). CANCELLED is deliberately absent:
// it is reachable from any chain state but is not a step, and `advance` walks
// this array by index.
export const CHAIN = [
  'DRAFT',
  'PUBLISHED',
  'REGISTRATION_CLOSED',
  'ONGOING',
  'COMPLETED',
  'CERTIFIED',
] as const satisfies readonly EventStatus[];

/**
 * The only gate on an event status write: one step forward along CHAIN, or any
 * chain state to CANCELLED. CERTIFIED and CANCELLED are terminal; spec 7.3 draws
 * no arrow off CERTIFIED because certificates are already issued against it.
 */
export function assertTransition(from: EventStatus, to: EventStatus): void {
  if (from === to) throw new UnprocessableError('That event is already in that state.');
  if (from === 'CANCELLED') throw new UnprocessableError('That event was cancelled.');
  if (from === 'CERTIFIED') throw new UnprocessableError('That event has issued certificates and is final.');
  if (to === 'CANCELLED') return;

  const at = CHAIN.indexOf(from as (typeof CHAIN)[number]);
  const next = CHAIN.indexOf(to as (typeof CHAIN)[number]);
  if (next !== at + 1) throw new UnprocessableError(`An event cannot go from ${from} to ${to}.`);
}

export interface DueStatusInput {
  status: EventStatus;
  registrationClosesAt: Date;
  checkInOpensAt: Date;
  checkInClosesAt: Date;
}

/**
 * The status an event's timestamps say it should be in. Pure, so a list read can
 * render it without writing. Boundaries are evaluated newest first because the
 * check-in window may open before registration closes and the later milestone
 * must win. DRAFT (unpublished) and the two terminal states never advance.
 */
export function dueStatus(event: DueStatusInput, now: Date): EventStatus {
  if (event.status === 'DRAFT' || event.status === 'CANCELLED' || event.status === 'CERTIFIED') {
    return event.status;
  }
  if (now > event.checkInClosesAt) return 'COMPLETED';
  if (now >= event.checkInOpensAt) return 'ONGOING';
  if (now >= event.registrationClosesAt) return 'REGISTRATION_CLOSED';
  return 'PUBLISHED';
}

/**
 * The club's edit gate plus the three terminal event states. Shared by
 * `EventsService.update` and the poster upload-url mint, which overwrites the
 * live poster object: guarding only one leaves the other as the way round it.
 */
export function assertEventAcceptsEdits(event: {
  status: EventStatus;
  club: { status: ClubStatus };
}): void {
  assertClubAcceptsEdits(event.club.status);
  if (event.status === 'CANCELLED' || event.status === 'COMPLETED' || event.status === 'CERTIFIED') {
    throw new UnprocessableError(`A ${event.status.toLowerCase()} event can no longer be edited.`);
  }
}
