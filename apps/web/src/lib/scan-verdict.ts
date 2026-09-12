import type { CheckInResult } from '@majlis/contracts';
import { STATUS } from '@/components/StatusBadge';

export type VerdictTone = 'ok' | 'warn' | 'bad';

export interface Verdict {
  tone: VerdictTone;
  /** Display scale, and the whole of what the operator reads at arm's length. */
  headline: string;
  /** A second line where the result carries one, never invented. */
  detail: string | null;
  /**
   * The two success shapes only. A refusal never names a student, which is
   * what stops a mis-scan disclosing an unrelated person to whoever is
   * holding the phone (spec 7.5).
   */
  person: { fullName: string; email: string } | null;
  /** One pulse for a success, two for a refusal. */
  pattern: number[];
}

const OK = [70];
const REFUSED = [70, 90, 70];

/**
 * The six outcomes, read off a phone in a lit hall. Colour is never the only
 * carrier: every verdict has words, and the screen draws an icon per tone.
 */
export function verdictOf(result: CheckInResult): Verdict {
  switch (result.result) {
    case 'CHECKED_IN':
      return {
        tone: 'ok',
        headline: 'Checked in',
        detail: null,
        person: { fullName: result.fullName, email: result.email },
        pattern: OK,
      };
    case 'ALREADY_CHECKED_IN':
      return {
        tone: 'warn',
        headline: 'Already checked in',
        // The original time, which is the operator's actual question: has this
        // person been through the door before?
        detail: new Date(result.checkedInAt).toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
          hourCycle: 'h23',
        }),
        person: { fullName: result.fullName, email: result.email },
        pattern: REFUSED,
      };
    case 'NOT_REGISTERED':
      return { tone: 'bad', headline: 'Not registered', detail: null, person: null, pattern: REFUSED };
    case 'REGISTRATION_CANCELLED':
      return { tone: 'bad', headline: 'Registration cancelled', detail: null, person: null, pattern: REFUSED };
    case 'EVENT_NOT_OPEN':
      return {
        tone: 'bad',
        headline: 'Check-in is not open',
        // The same word the badge on every other screen shows for that
        // status. A second spelling of it here is how "Registration Closed"
        // and "Registration closed" end up in one product.
        detail: STATUS[result.eventStatus].label,
        person: null,
        pattern: REFUSED,
      };
    case 'INVALID_PASS':
      return { tone: 'bad', headline: 'Pass not valid', detail: null, person: null, pattern: REFUSED };
  }
}
