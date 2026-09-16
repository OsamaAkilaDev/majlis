import type { Notification } from '@majlis/contracts';
import { enumLabel } from './enum-label';

/**
 * One inbox row, derived from the row's JSONB payload. The payload carries
 * ids and display strings only (spec 7.7), so every field here is read
 * defensively: a notification written before a payload key existed must
 * still render as a row the reader can act on, not as a blank line.
 */
export interface NotificationLine {
  /** The subject the notification is about: an event title, a club name. */
  title: string;
  /** What happened to it. */
  detail: string;
  /** Where the row leads, or null when there is nothing to open. */
  href: string | null;
}

function text(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** The five fields a material event change can touch, in a reader's words. */
const FIELD_WORDS: Record<string, string> = {
  startsAt: 'start time',
  endsAt: 'end time',
  venue: 'venue',
  onlineUrl: 'online link',
  timezone: 'timezone',
};

function changedWords(payload: Record<string, unknown>): string {
  const changed = payload.changed;
  if (!Array.isArray(changed)) return 'Details changed';
  const words = changed
    .filter((c): c is string => typeof c === 'string')
    .map((c) => FIELD_WORDS[c] ?? c);
  return words.length > 0 ? `Changed: ${words.join(', ')}` : 'Details changed';
}

export function notificationLine(notification: Notification): NotificationLine {
  const p = notification.payload;
  const eventId = text(p, 'eventId');
  const eventHref = eventId ? `/events/${eventId}` : null;
  const eventTitle = text(p, 'eventTitle') ?? 'An event';
  const clubName = text(p, 'clubName') ?? 'A club';
  const reason = text(p, 'reason');

  switch (notification.type) {
    case 'team.invited': {
      const role = text(p, 'role');
      return { title: clubName, detail: role ? `Invited as ${enumLabel(role)}` : 'Invited to the team', href: '/profile' };
    }
    case 'membership.decided': {
      const status = text(p, 'status');
      const detail =
        status === 'ACTIVE'
          ? 'Membership approved'
          : status === 'REJECTED'
            ? 'Membership declined'
            : 'Membership decided';
      return { title: clubName, detail, href: '/profile' };
    }
    case 'event.published':
      return { title: eventTitle, detail: `Published by ${clubName}`, href: eventHref };
    case 'registration.confirmed':
      return { title: eventTitle, detail: 'Registration confirmed', href: eventHref };
    case 'registration.waitlisted': {
      const position = p.waitlistPosition;
      return {
        title: eventTitle,
        detail: typeof position === 'number' ? `Waitlisted at position ${position}` : 'Waitlisted',
        href: eventHref,
      };
    }
    case 'registration.promoted':
      return { title: eventTitle, detail: 'Moved off the waitlist', href: eventHref };
    case 'event.changed':
      return { title: eventTitle, detail: changedWords(p), href: eventHref };
    case 'event.cancelled':
      return { title: eventTitle, detail: reason ? `Cancelled: ${reason}` : 'Cancelled', href: eventHref };
    case 'certificate.issued': {
      const serial = text(p, 'serialNumber');
      return {
        title: eventTitle,
        detail: serial ? `Certificate issued, ${serial}` : 'Certificate issued',
        href: '/profile/certificates',
      };
    }
    case 'certificate.revoked':
      return {
        title: eventTitle,
        detail: reason ? `Certificate revoked: ${reason}` : 'Certificate revoked',
        href: '/profile/certificates',
      };
    // Never listed by the API, which excludes it from the inbox because its
    // payload is a live credential. Present so the switch stays exhaustive.
    case 'auth.password_reset':
      return { title: 'Password reset', detail: 'Requested', href: null };
  }
}
