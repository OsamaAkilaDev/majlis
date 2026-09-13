import type { NotificationType } from '@majlis/contracts';

/**
 * One notification to write. `subject` is the id (or id-plus-timestamp) the
 * trigger is about; `dedupeKey` is composed from the type and it, so a
 * retried action lands on the same key and the `(user_id, dedupe_key)`
 * unique index absorbs the second write.
 *
 * `payload` carries ids and display strings only, never an email address,
 * and never anything a log would have to redact.
 */
export interface NotificationEntry {
  userId: string;
  type: NotificationType;
  subject: string;
  payload: Record<string, unknown>;
  /**
   * Only for a notification already delivered inline, which is the password
   * reset and nothing else. Left absent, the row starts PENDING and the
   * sweep picks it up, which is what every other trigger wants.
   */
  delivered?: { status: 'SENT' | 'SKIPPED' | 'FAILED'; error?: string };
}

/**
 * `registration.confirmed:<registrationId>`, `event.cancelled:<eventId>`.
 * One function rather than a literal at each of the ten call sites: the key
 * is what makes a retry idempotent, and two call sites composing it
 * differently would silently double-notify.
 */
export function dedupeKeyFor(type: NotificationType, subject: string): string {
  return `${type}:${subject}`;
}

/**
 * The type the password reset link travels under. Named because two modules
 * need it and neither should own it: AuthService writes it, and
 * NotificationService excludes it from the inbox.
 */
export const PASSWORD_RESET_TYPE = 'auth.password_reset' satisfies NotificationType;
