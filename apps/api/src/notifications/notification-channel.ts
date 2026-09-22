import type { NotificationType } from '@majlis/contracts';

/**
 * The recipient's address is read from the user row at delivery time and never
 * stored on the notification: spec 7.7's payload carries ids and display
 * strings only. No row id, deliberately: the password reset is delivered from
 * a payload that exists only on the calling stack and belongs to no row.
 */
export interface DeliverableNotification {
  type: NotificationType;
  payload: Record<string, unknown>;
  recipientEmail: string;
  recipientName: string;
}

// Maps straight onto the `email_status` column; FAILED carries the error so an
// Admin can see why (spec 7.7).
export type DeliveryOutcome =
  | { status: 'SENT' }
  | { status: 'SKIPPED' }
  | { status: 'FAILED'; error: string };

export interface NotificationChannel {
  deliver(notification: DeliverableNotification): Promise<DeliveryOutcome>;
}

/** The DI token. An interface has no runtime value for Nest to resolve. */
export const NOTIFICATION_CHANNEL = 'NOTIFICATION_CHANNEL';

// The shipped default, resolved when no BREVO_API_KEY is set: every row lands
// on SKIPPED and the in-app inbox still works.
export class SkippingChannel implements NotificationChannel {
  async deliver(): Promise<DeliveryOutcome> {
    return { status: 'SKIPPED' };
  }
}
