import { Resend } from 'resend';
import { renderNotificationEmail } from './emails/templates';
import type { DeliverableNotification, DeliveryOutcome, NotificationChannel } from './notification-channel';

/**
 * Resolves only when RESEND_API_KEY is set; otherwise the module provides
 * SkippingChannel. The key stays with the SDK and is never logged: failures
 * are reported as the SDK's message, and the outbound Authorization header is
 * covered by LOG_REDACT_PATHS. Never throws, so one bad send cannot stop a batch.
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
