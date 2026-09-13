import type { NotificationType } from '@majlis/contracts';
import { render } from '@react-email/render';
import type { ReactElement } from 'react';
import { EmailLayout, EmailText } from './layout';

export interface TemplateInput {
  recipientName: string;
  payload: Record<string, unknown>;
  /** PUBLIC_WEB_ORIGIN, already stripped of a trailing slash. */
  webOrigin: string;
}

interface Template {
  subject: (input: TemplateInput) => string;
  body: (input: TemplateInput) => ReactElement;
}

/** A payload value as a display string. Payloads are JSONB, so nothing is typed. */
function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

function title(input: TemplateInput): string {
  return str(input.payload.eventTitle, 'an event');
}

function club(input: TemplateInput): string {
  return str(input.payload.clubName, 'a club');
}

/**
 * One template per notification type. They are deliberately separate rather
 * than one component switching on `type`: the subject line and the body of
 * each of these is product copy somebody will want to edit alone, and a
 * single parameterised template makes every edit a change to all eleven.
 */
export const TEMPLATES: Record<NotificationType, Template> = {
  'team.invited': {
    subject: (i) => `You have been invited to the ${club(i)} team`,
    body: (i) => (
      <EmailLayout
        preview={`${club(i)} invited you as ${str(i.payload.role)}`}
        heading="A club team invitation"
        actionUrl={`${i.webOrigin}/me`}
        actionLabel="Review the invitation"
      >
        <EmailText>Hello {i.recipientName},</EmailText>
        <EmailText>
          {club(i)} has invited you to join its team as {str(i.payload.role, 'an officer')}.
        </EmailText>
      </EmailLayout>
    ),
  },

  'membership.decided': {
    subject: (i) =>
      i.payload.status === 'ACTIVE'
        ? `You are now a member of ${club(i)}`
        : `Your ${club(i)} membership request was not approved`,
    body: (i) => (
      <EmailLayout
        preview={`${club(i)} has decided your membership request`}
        heading={i.payload.status === 'ACTIVE' ? 'Membership approved' : 'Membership not approved'}
        actionUrl={`${i.webOrigin}/me`}
        actionLabel="Open Majlis"
      >
        <EmailText>Hello {i.recipientName},</EmailText>
        <EmailText>
          {club(i)} has {i.payload.status === 'ACTIVE' ? 'approved' : 'declined'} your membership
          request.
        </EmailText>
      </EmailLayout>
    ),
  },

  'event.published': {
    subject: (i) => `${club(i)} published ${title(i)}`,
    body: (i) => (
      <EmailLayout
        preview={`${title(i)} is open for registration`}
        heading={title(i)}
        actionUrl={`${i.webOrigin}/events`}
        actionLabel="See the event"
      >
        <EmailText>Hello {i.recipientName},</EmailText>
        <EmailText>{club(i)} has published a new event and registration is open.</EmailText>
      </EmailLayout>
    ),
  },

  'registration.confirmed': {
    subject: (i) => `You have a place at ${title(i)}`,
    body: (i) => (
      <EmailLayout
        preview={`Your place at ${title(i)} is confirmed`}
        heading="Your place is confirmed"
        actionUrl={`${i.webOrigin}/me/registrations`}
        actionLabel="See your registrations"
      >
        <EmailText>Hello {i.recipientName},</EmailText>
        <EmailText>You are confirmed for {title(i)}.</EmailText>
      </EmailLayout>
    ),
  },

  'registration.waitlisted': {
    subject: (i) => `You are on the waitlist for ${title(i)}`,
    body: (i) => (
      <EmailLayout
        preview={`You are on the waitlist for ${title(i)}`}
        heading="You are on the waitlist"
        actionUrl={`${i.webOrigin}/me/registrations`}
        actionLabel="See your registrations"
      >
        <EmailText>Hello {i.recipientName},</EmailText>
        <EmailText>
          {title(i)} is full. You hold waitlist position{' '}
          {typeof i.payload.waitlistPosition === 'number' ? i.payload.waitlistPosition : 'unknown'}.
        </EmailText>
      </EmailLayout>
    ),
  },

  'registration.promoted': {
    subject: (i) => `A place opened up at ${title(i)}`,
    body: (i) => (
      <EmailLayout
        preview={`You have moved off the waitlist for ${title(i)}`}
        heading="You have a place"
        actionUrl={`${i.webOrigin}/me/registrations`}
        actionLabel="See your registrations"
      >
        <EmailText>Hello {i.recipientName},</EmailText>
        <EmailText>You have moved off the waitlist and are confirmed for {title(i)}.</EmailText>
      </EmailLayout>
    ),
  },

  'event.changed': {
    subject: (i) => `${title(i)} has changed`,
    body: (i) => (
      <EmailLayout
        preview={`Details for ${title(i)} have changed`}
        heading={`${title(i)} has changed`}
        actionUrl={`${i.webOrigin}/events`}
        actionLabel="See the new details"
      >
        <EmailText>Hello {i.recipientName},</EmailText>
        <EmailText>
          The organisers changed{' '}
          {Array.isArray(i.payload.changed) ? i.payload.changed.join(', ') : 'the event details'}.
        </EmailText>
      </EmailLayout>
    ),
  },

  'event.cancelled': {
    subject: (i) => `${title(i)} has been cancelled`,
    body: (i) => (
      <EmailLayout
        preview={`${title(i)} has been cancelled`}
        heading={`${title(i)} has been cancelled`}
        actionUrl={`${i.webOrigin}/events`}
        actionLabel="Open Majlis"
      >
        <EmailText>Hello {i.recipientName},</EmailText>
        <EmailText>{str(i.payload.reason, 'No reason was given.')}</EmailText>
      </EmailLayout>
    ),
  },

  'certificate.issued': {
    subject: (i) => `Your certificate for ${title(i)}`,
    body: (i) => (
      <EmailLayout
        preview={`Your certificate for ${title(i)} is ready`}
        heading="Your certificate is ready"
        actionUrl={`${i.webOrigin}/me/certificates`}
        actionLabel="Download it"
      >
        <EmailText>Hello {i.recipientName},</EmailText>
        <EmailText>
          Serial {str(i.payload.serialNumber, 'unknown')} for {title(i)}.
        </EmailText>
      </EmailLayout>
    ),
  },

  'certificate.revoked': {
    subject: (i) => `Your certificate for ${title(i)} was revoked`,
    body: (i) => (
      <EmailLayout
        preview={`Your certificate for ${title(i)} was revoked`}
        heading="A certificate was revoked"
        actionUrl={`${i.webOrigin}/me/certificates`}
        actionLabel="Open Majlis"
      >
        <EmailText>Hello {i.recipientName},</EmailText>
        <EmailText>{str(i.payload.reason, 'No reason was given.')}</EmailText>
      </EmailLayout>
    ),
  },

  'auth.password_reset': {
    subject: () => 'Reset your Majlis password',
    body: (i) => (
      <EmailLayout
        preview="Reset your Majlis password"
        heading="Reset your password"
        actionUrl={str(i.payload.resetUrl, `${i.webOrigin}/forgot-password`)}
        actionLabel="Choose a new password"
      >
        <EmailText>Hello {i.recipientName},</EmailText>
        <EmailText>
          This link works once and expires in{' '}
          {typeof i.payload.expiresInMinutes === 'number' ? i.payload.expiresInMinutes : 30} minutes.
          If you did not ask for it, ignore this message.
        </EmailText>
      </EmailLayout>
    ),
  },
};

/** The subject and HTML one notification is delivered as. */
export async function renderNotificationEmail(
  type: NotificationType,
  input: TemplateInput,
): Promise<{ subject: string; html: string }> {
  const template = TEMPLATES[type];
  return { subject: template.subject(input), html: await render(template.body(input)) };
}
