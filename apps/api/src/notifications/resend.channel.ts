import { Resend } from 'resend';
import { renderNotificationEmail } from './emails/templates';
import type { DeliverableNotification, DeliveryOutcome, NotificationChannel } from './notification-channel';

/**
 * The email implementation of spec 7.7's channel. It resolves only when
 * RESEND_API_KEY is set; with no key the module provides SkippingChannel
 * instead, and nothing here ever runs.
 *
 * The key is held by the SDK and never logged: a failure is reported as the
 * SDK's message, which carries no credential, and the outbound request's
 * Authorization header is already covered by LOG_REDACT_PATHS.
 *
 * This never throws. A refused address, a rate limit and an outage are all
 * ordinary outcomes of sending mail, and one of them must not stop the rest
 * of the sweep's batch.
 */
export class ResendChannel implements NotificationChannel {
  private readonly resend: Resend;

  constructor(
    apiKey: string,
    private readonly from: string,
    private readonly webOrigin: string,
  ) {
    this.resend = new Resend(apiKey);
  }

  async deliver(notification: DeliverableNotification): Promise<DeliveryOutcome> {
    const { subject, html } = await renderNotificationEmail(notification.type, {
      recipientName: notification.recipientName,
      payload: notification.payload,
      webOrigin: this.webOrigin,
    });

    const { error } = await this.resend.emails.send({
      from: this.from,
      to: notification.recipientEmail,
      subject,
      html,
    });

    // The SDK reports a rejected send as a value, not a throw. Treating
    // `error` as absent would mark every bounced address SENT.
    return error ? { status: 'FAILED', error: error.message } : { status: 'SENT' };
  }
}
