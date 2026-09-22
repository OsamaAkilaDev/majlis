import { renderNotificationEmail } from './emails/templates';
import type { DeliverableNotification, DeliveryOutcome, NotificationChannel } from './notification-channel';

const ENDPOINT = 'https://api.brevo.com/v3/smtp/email';

/**
 * `Majlis <notifications@majlis.test>`, or a bare address. Brevo wants the
 * display name and the address as separate fields and rejects the combined
 * string as an email, so this is not cosmetic.
 */
function parseSender(from: string): { email: string; name?: string } {
  const match = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(from);
  const address = match?.[2];
  if (!address) return { email: from.trim() };
  return match?.[1] ? { name: match[1], email: address } : { email: address };
}

/**
 * Resolves only when BREVO_API_KEY is set; otherwise the module provides
 * SkippingChannel. Brevo is here because it verifies a single sender address
 * by email rather than a domain by DNS, so a fresh deployment can send real
 * mail from an ordinary inbox with nothing bought and no records published.
 *
 * Plain `fetch` rather than @getbrevo/brevo: one POST does not need a
 * generated SDK. Never throws, so one bad send cannot stop a sweep batch.
 */
export class BrevoChannel implements NotificationChannel {
  private readonly sender: { email: string; name?: string };

  constructor(
    private readonly apiKey: string,
    from: string,
    private readonly webOrigin: string,
  ) {
    this.sender = parseSender(from);
  }

  async deliver(notification: DeliverableNotification): Promise<DeliveryOutcome> {
    const { subject, html } = await renderNotificationEmail(notification.type, {
      recipientName: notification.recipientName,
      payload: notification.payload,
      webOrigin: this.webOrigin,
    });

    try {
      const response = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'api-key': this.apiKey, 'content-type': 'application/json' },
        body: JSON.stringify({
          sender: this.sender,
          to: [{ email: notification.recipientEmail, name: notification.recipientName }],
          subject,
          htmlContent: html,
        }),
      });

      // fetch resolves a 400 as readily as a 201, so `ok` is the only thing
      // separating them. Without this check every rejected send reads SENT.
      if (response.ok) return { status: 'SENT' };
      return this.failed(await reason(response));
    } catch (cause) {
      return this.failed(cause instanceof Error ? cause.message : String(cause));
    }
  }

  /** The stored error reaches an Admin's screen, so it is a log surface. */
  private failed(message: string): DeliveryOutcome {
    return { status: 'FAILED', error: message.replaceAll(this.apiKey, '[redacted]') };
  }
}

/** Brevo reports `{ code, message }`; fall back to the status for anything else. */
async function reason(response: Response): Promise<string> {
  const detail = await response
    .json()
    .then((body) => (body as { message?: string } | null)?.message)
    .catch(() => undefined);
  return detail ? `${response.status} ${detail}` : `${response.status} ${response.statusText}`.trim();
}
