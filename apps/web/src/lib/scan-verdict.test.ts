import { describe, expect, it } from 'vitest';
import { verdictOf } from './scan-verdict';

const HOLDER = {
  fullName: 'Layla Hassan',
  email: 'student@uni.ac.ae',
  checkedInAt: '2026-09-13T09:15:00.000Z',
};

describe('verdictOf', () => {
  it('names the person on the two outcomes that carry one, and on no other', () => {
    // The disclosure rule of spec 7.5, which is the reason the refusals have
    // no name field at all. A mapping that reached for fullName on every
    // result would still render the two successes correctly and would leak an
    // unrelated person's identity on a mis-scan.
    expect(verdictOf({ result: 'CHECKED_IN', ...HOLDER }).person).toEqual({
      fullName: 'Layla Hassan',
      email: 'student@uni.ac.ae',
    });
    expect(verdictOf({ result: 'ALREADY_CHECKED_IN', ...HOLDER }).person).toEqual({
      fullName: 'Layla Hassan',
      email: 'student@uni.ac.ae',
    });

    for (const result of [
      { result: 'NOT_REGISTERED' },
      { result: 'REGISTRATION_CANCELLED' },
      { result: 'EVENT_NOT_OPEN', eventStatus: 'COMPLETED' },
      { result: 'INVALID_PASS' },
    ] as const) {
      expect(verdictOf(result).person).toBeNull();
    }
  });

  it('gives each of the six outcomes its own words, not only its own colour', () => {
    // Three tones across six results, so words are the only thing that tells
    // "not registered" from "pass not valid". A mapping that returned one
    // headline per tone passes every colour assertion and is unusable.
    const headlines = [
      verdictOf({ result: 'CHECKED_IN', ...HOLDER }),
      verdictOf({ result: 'ALREADY_CHECKED_IN', ...HOLDER }),
      verdictOf({ result: 'NOT_REGISTERED' }),
      verdictOf({ result: 'REGISTRATION_CANCELLED' }),
      verdictOf({ result: 'EVENT_NOT_OPEN', eventStatus: 'COMPLETED' }),
      verdictOf({ result: 'INVALID_PASS' }),
    ].map((v) => v.headline);

    expect(new Set(headlines).size).toBe(6);
    expect(headlines.every((h) => h.trim().length > 0)).toBe(true);
  });

  it('separates the one success from the five outcomes that are not', () => {
    // ALREADY_CHECKED_IN is the trap: it carries a name and a time like a
    // success and is not one. Tone and haptic both have to say so.
    expect(verdictOf({ result: 'CHECKED_IN', ...HOLDER }).tone).toBe('ok');
    expect(verdictOf({ result: 'CHECKED_IN', ...HOLDER }).pattern).toHaveLength(1);

    for (const result of [
      { result: 'ALREADY_CHECKED_IN', ...HOLDER },
      { result: 'NOT_REGISTERED' },
      { result: 'REGISTRATION_CANCELLED' },
      { result: 'EVENT_NOT_OPEN', eventStatus: 'COMPLETED' },
      { result: 'INVALID_PASS' },
    ] as const) {
      const verdict = verdictOf(result);
      expect(verdict.tone).not.toBe('ok');
      // Two pulses, which is three entries: buzz, pause, buzz.
      expect(verdict.pattern).toHaveLength(3);
    }
  });

  it('carries the original check-in time, not the moment of the rescan', () => {
    // 12-hour, like every clock in the product (decided 2026-09-19). A 24-hour
    // reading and a bare "1:15" both fail this.
    const verdict = verdictOf({ result: 'ALREADY_CHECKED_IN', ...HOLDER });
    expect(verdict.detail).toMatch(/^\d{1,2}:\d{2} (AM|PM)$/);
  });

  it('names the status that closed check-in', () => {
    // Without it the operator is told "not open" and cannot tell a draft from
    // an event that finished yesterday.
    expect(verdictOf({ result: 'EVENT_NOT_OPEN', eventStatus: 'REGISTRATION_CLOSED' }).detail).toBe(
      'Registration closed',
    );
  });
});
