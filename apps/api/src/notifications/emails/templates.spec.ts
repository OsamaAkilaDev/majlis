import { notificationTypeSchema } from '@majlis/contracts';
import { describe, expect, it } from 'vitest';
import { TEMPLATES, renderNotificationEmail } from './templates';

const input = {
  recipientName: 'Sara Al Mansoori',
  payload: {
    eventTitle: 'Drone Build Night',
    clubName: 'Robotics Club',
    role: 'OPERATIONS',
    status: 'ACTIVE',
    serialNumber: 'MJL-2026-000123',
    reason: 'The venue flooded.',
    changed: ['venue'],
    waitlistPosition: 3,
  },
  webOrigin: 'https://majlis.test',
};

describe('notification email templates', () => {
  it('has one template per notification type, with none left over', () => {
    // Catches a type added to the contract with no template behind it: the
    // channel would throw on `template.subject` mid-sweep and the row would
    // land FAILED with a TypeError as its reason.
    expect(Object.keys(TEMPLATES).sort()).toEqual([...notificationTypeSchema.options].sort());
  });

  for (const type of notificationTypeSchema.options) {
    it(`renders ${type} into a subject and real HTML`, async () => {
      const { subject, html } = await renderNotificationEmail(type, input);

      expect(subject.length).toBeGreaterThan(0);
      expect(html).toContain('<html');
      // The recipient's name proves the template actually consumed its
      // input rather than rendering a fixed shell.
      expect(html).toContain('Sara Al Mansoori');
    });
  }

  it('puts the single-use reset link in the password reset email', async () => {
    const { html } = await renderNotificationEmail('auth.password_reset', {
      ...input,
      payload: { resetUrl: 'https://majlis.test/reset-password?token=abc123', expiresInMinutes: 30 },
    });

    expect(html).toContain('https://majlis.test/reset-password?token=abc123');
  });

  it('falls back to a display string when the payload is missing a field', async () => {
    // Payloads are JSONB and typed as unknown, so a row written by an older
    // build must render rather than print "undefined" at a student.
    const { subject, html } = await renderNotificationEmail('registration.confirmed', {
      ...input,
      payload: {},
    });

    expect(subject).not.toContain('undefined');
    expect(html).not.toContain('undefined');
  });
});
