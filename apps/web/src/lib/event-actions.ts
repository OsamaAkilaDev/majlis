import type { ClubRole, EventDetail, EventResponsibility, SessionUser } from '@majlis/contracts';

/**
 * A mirror of PERMISSIONS in `apps/api/src/auth/permissions.ts`, kept honest by
 * event-actions.test.ts, which parses that file and compares.
 *
 * Presentation only: it decides which controls the event page draws. The guard
 * re-derives every one of them per request and is the protection.
 */
export type EventActionKey = 'publish' | 'edit' | 'attendees' | 'checkIn' | 'cancel';

interface Rule {
  club: readonly ClubRole[];
  event: readonly EventResponsibility[];
}

/** The permission each control is gated on, server-side. The `event` column is
 *  what lets a per-event assignment reach the roster and the scanner without
 *  making anybody a standing officer. */
export const EVENT_ACTION_ROLES = {
  publish: { club: ['LEAD', 'VICE_LEAD'], event: [] },
  edit: { club: ['LEAD', 'VICE_LEAD', 'MARKETING', 'CTO', 'OPERATIONS'], event: [] },
  attendees: { club: ['LEAD', 'VICE_LEAD'], event: ['EVENT_LEAD', 'OPERATIONS'] },
  checkIn: { club: ['LEAD', 'OPERATIONS'], event: ['EVENT_LEAD', 'OPERATIONS'] },
  cancel: { club: ['LEAD'], event: [] },
} as const satisfies Record<EventActionKey, Rule>;

export interface EventAction {
  key: EventActionKey;
  label: string;
  /** Appended to `/events/{eventId}/`, or null for one performed in place. */
  path: string | null;
}

const ACTIONS: EventAction[] = [
  { key: 'publish', label: 'Publish', path: null },
  { key: 'edit', label: 'Edit', path: 'edit' },
  { key: 'attendees', label: 'Attendees', path: 'attendees' },
  { key: 'checkIn', label: 'Check in', path: 'check-in' },
  { key: 'cancel', label: 'Cancel event', path: null },
];

/**
 * `dueStatus` in `apps/api/src/events/event-status.ts`, which is what the lazy
 * lifecycle writes on the next read. An event is ONGOING for exactly as long
 * as it runs, and that is what "while the event is live" means for check-in.
 */
function isLive(event: EventDetail, now: Date): boolean {
  if (event.status === 'DRAFT' || event.status === 'CANCELLED' || event.status === 'CERTIFIED') {
    return false;
  }
  const at = now.getTime();
  return at >= Date.parse(event.startsAt) && at <= Date.parse(event.endsAt);
}

/** The three terminal states of `assertEventAcceptsEdits`. */
const UNEDITABLE = ['CANCELLED', 'COMPLETED', 'CERTIFIED'];

/** `assertTransition` refuses every move out of these two. */
const TERMINAL = ['CANCELLED', 'CERTIFIED'];

function applies(key: EventActionKey, event: EventDetail, now: Date): boolean {
  switch (key) {
    case 'publish':
      return event.status === 'DRAFT';
    case 'edit':
      return !UNEDITABLE.includes(event.status);
    case 'cancel':
      return !TERMINAL.includes(event.status);
    case 'checkIn':
      return isLive(event, now);
    case 'attendees':
      return true;
  }
}

export function eventActionsFor(
  event: EventDetail,
  now: Date,
  platformRole: SessionUser['platformRole'],
): EventAction[] {
  return ACTIONS.filter((action) => {
    if (!applies(action.key, event, now)) return false;
    if (platformRole === 'ADMIN') return true;
    const rule = EVENT_ACTION_ROLES[action.key];
    return (
      rule.club.some((r) => event.viewerClubRoles.includes(r)) ||
      rule.event.some((r) => event.viewerResponsibilities.includes(r))
    );
  });
}
