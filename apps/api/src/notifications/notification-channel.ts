import type { NotificationType } from '@majlis/contracts';

/**
 * One notification, resolved into everything a channel needs to deliver it.
 * The recipient's address is read from the user row at delivery time and
 * never stored on the notification: spec 7.7's payload carries ids and
 * display strings only.
 *
 * There is deliberately no row id here. The password reset is delivered
 * inline, from a payload that exists only on the calling stack and is never
 * the payload any row holds, so a channel that needed an id would have
 * nothing to give it.
 */
export interface DeliverableNotification {
  type: NotificationType;
  payload: Record<string, unknown>;
  recipientEmail: string;
  recipientName: string;
}

/**
 * What one delivery attempt did, mapped straight onto the `email_status`
 * column. FAILED carries the error so an Admin can see why, per spec 7.7.
 */
export type DeliveryOutcome =
  | { status: 'SENT' }
  | { status: 'SKIPPED' }
  | { status: 'FAILED'; error: string };

export interface NotificationChannel {
  deliver(notification: DeliverableNotification): Promise<DeliveryOutcome>;
}

/** The DI token. An interface has no runtime value for Nest to resolve. */
export const NOTIFICATION_CHANNEL = 'NOTIFICATION_CHANNEL';

/**
 * What resolves when no RESEND_API_KEY is configured, which is the shipped
 * default. Every row lands on SKIPPED, nothing is sent, and the in-app inbox
 * works completely. Pasting a key in later turns email on with no code
 * change.
 */
export class SkippingChannel implements NotificationChannel {
  async deliver(): Promise<DeliveryOutcome> {
    return { status: 'SKIPPED' };
  }
}
