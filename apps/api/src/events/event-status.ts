import type { ClubStatus, EventStatus } from '@majlis/contracts';
import { assertAcceptsEdits as assertClubAcceptsEdits } from '../clubs/club-status';
import { UnprocessableError } from '../common/problem/domain-error';

/**
 * The linear part of the lifecycle (spec 7.3). CANCELLED is deliberately not
 * in it: it is reachable from any chain state but is not a step along the
 * chain, and `advance` walks this array by index.
 */
export const CHAIN = [
  'DRAFT',
  'PUBLISHED',
  'REGISTRATION_CLOSED',
  'ONGOING',
  'COMPLETED',
  'CERTIFIED',
] as const satisfies readonly EventStatus[];

/**
 * The only gate on an event status write. One step forward along CHAIN, or
 * anything that is still in the chain to CANCELLED.
 *
 * CERTIFIED and CANCELLED are both terminal. Cancelling a CERTIFIED event is
 * refused because certificates have already been issued against it, and the
 * spec 7.3 diagram draws no arrow from CERTIFIED for exactly that reason.
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
 * The status an event's own timestamps say it should be in — a pure function,
 * which is what lets a list read render it without writing anything.
 *
 * Boundaries are evaluated newest first, because the check-in window may open
 * before registration closes: the later milestone must win, or an event whose
 * check-in has already started would be reported as merely closed.
 *
 * DRAFT, CANCELLED and CERTIFIED are never time-advanced. The first is not
 * published yet and the other two are terminal.
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
 * Whether this event still accepts edits: its club's own edit gate, plus the
 * three terminal event states.
 *
 * Shared by `EventsService.update` and by the poster upload-url mint, which
 * overwrites the live poster object and so is an edit as much as a PATCH is.
 * A guard in only one of the two leaves the other as the way round it.
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
