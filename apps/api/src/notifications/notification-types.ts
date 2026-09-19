import type { NotificationType } from '@majlis/contracts';

/**
 * `subject` is the id the trigger is about; the dedupe key is composed from it
 * and the type, so a retried action lands on the same key and the
 * `(user_id, dedupe_key)` unique index absorbs the second write. `payload`
 * carries ids and display strings only, never an address or anything to redact.
 */
export interface NotificationEntry {
  userId: string;
  type: NotificationType;
  subject: string;
  payload: Record<string, unknown>;
  // Only for a notification already delivered inline, which is the password
  // reset alone. Absent, the row starts PENDING and the sweep picks it up.
  delivered?: { status: 'SENT' | 'SKIPPED' | 'FAILED'; error?: string };
}

// One function rather than a literal per call site: the key is what makes a
// retry idempotent, and two sites composing it differently double-notify.
export function dedupeKeyFor(type: NotificationType, subject: string): string {
  return `${type}:${subject}`;
}

// AuthService writes it, NotificationService excludes it from the inbox.
export const PASSWORD_RESET_TYPE = 'auth.password_reset' satisfies NotificationType;
