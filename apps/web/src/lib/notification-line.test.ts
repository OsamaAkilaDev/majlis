import type { Notification, NotificationType } from '@majlis/contracts';
import { describe, expect, it } from 'vitest';
import { notificationLine } from './notification-line';

function row(type: NotificationType, payload: Record<string, unknown>): Notification {
  return { id: 'n1', type, payload, readAt: null, createdAt: '2026-09-13T10:00:00.000Z' };
}

const TYPES: NotificationType[] = [
  'team.invited',
  'membership.decided',
  'event.published',
  'registration.confirmed',
  'registration.waitlisted',
  'registration.promoted',
  'event.changed',
  'event.cancelled',
  'certificate.issued',
  'certificate.revoked',
  'auth.password_reset',
];

describe('notificationLine', () => {
  it('reads the event payload the API actually writes', () => {
    expect(
      notificationLine(
        row('registration.waitlisted', {
          registrationId: 'r1',
          eventId: 'e1',
          eventTitle: 'Drone Build Night',
          status: 'WAITLISTED',
          waitlistPosition: 3,
        }),
      ),
    ).toEqual({ title: 'Drone Build Night', detail: 'Waitlisted at position 3', href: '/events/e1' });
  });

  it('tells approval and rejection apart', () => {
    // A single "Membership decided" line for both would read as approval to
    // somebody who was rejected, and the payload is the only thing that says.
    const base = { membershipId: 'm1', clubId: 'c1', clubName: 'Robotics Club' };
    expect(notificationLine(row('membership.decided', { ...base, status: 'ACTIVE' })).detail).toBe(
      'Membership approved',
    );
    expect(notificationLine(row('membership.decided', { ...base, status: 'REJECTED' })).detail).toBe(
      'Membership declined',
    );
  });

  it('names the fields a material event change touched', () => {
    expect(
      notificationLine(
        row('event.changed', { eventId: 'e1', eventTitle: 'ROS 2', changed: ['startsAt', 'venue'] }),
      ).detail,
    ).toBe('Changed: start time, venue');
  });

  it('renders a row for every type, with no payload at all', () => {
    // A notification written before a payload key existed must still be a row
    // the reader can act on. Catches a formatter that indexes the payload
    // straight into the string and renders "undefined" at every one of them.
    for (const type of TYPES) {
      const line = notificationLine(row(type, {}));
      expect(line.title).not.toBe('');
      expect(line.title).not.toContain('undefined');
      expect(line.detail).not.toContain('undefined');
      if (line.href !== null) expect(line.href).not.toContain('undefined');
    }
  });

  it('drops the link when the payload carries no event id', () => {
    expect(notificationLine(row('event.cancelled', { eventTitle: 'ROS 2' })).href).toBeNull();
  });
});
