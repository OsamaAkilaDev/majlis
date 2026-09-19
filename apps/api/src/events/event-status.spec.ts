import { describe, expect, it } from 'vitest';
import { UnprocessableError } from '../common/problem/domain-error';
import { CHAIN, assertTransition, dueStatus } from './event-status';

const AT = (iso: string) => new Date(iso);

function anEvent(status: Parameters<typeof dueStatus>[0]['status']) {
  return {
    status,
    registrationClosesAt: AT('2026-10-01T10:00:00Z'),
    checkInOpensAt: AT('2026-10-01T11:00:00Z'),
    checkInClosesAt: AT('2026-10-01T15:00:00Z'),
  };
}

describe('assertTransition', () => {
  it('allows exactly one step forward along the chain', () => {
    for (let i = 0; i < CHAIN.length - 1; i += 1) {
      expect(() => assertTransition(CHAIN[i]!, CHAIN[i + 1]!)).not.toThrow();
    }
  });

  it('refuses a skipped step, a step backwards, and a repeat of the current state', () => {
    // Catches a check of chain membership rather than adjacency: publishing
    // straight to COMPLETED would skip the whole registration window.
    expect(() => assertTransition('DRAFT', 'ONGOING')).toThrow(UnprocessableError);
    expect(() => assertTransition('ONGOING', 'PUBLISHED')).toThrow(UnprocessableError);
    expect(() => assertTransition('PUBLISHED', 'PUBLISHED')).toThrow(UnprocessableError);
  });

  it('refuses every transition out of CANCELLED and CERTIFIED', () => {
    // The two terminal states. A publish route that checked only "is this
    // event in DRAFT" would leave the CANCELLED case to this function.
    expect(() => assertTransition('CANCELLED', 'PUBLISHED')).toThrow('That event was cancelled.');
    expect(() => assertTransition('CERTIFIED', 'CANCELLED')).toThrow(
      'That event has issued certificates and is final.',
    );
  });

  it('allows any chain state to be cancelled', () => {
    for (const from of CHAIN) {
      if (from === 'CERTIFIED') continue;
      expect(() => assertTransition(from, 'CANCELLED')).not.toThrow();
    }
  });
});

describe('dueStatus', () => {
  it('reads the newest boundary that has passed, not the first one', () => {
    // At 11:30 both registrationClosesAt (10:00) and checkInOpensAt (11:00) have
    // passed. Testing the earliest boundary first answers REGISTRATION_CLOSED
    // and the event never opens for scanning.
    expect(dueStatus(anEvent('PUBLISHED'), AT('2026-10-01T11:30:00Z'))).toBe('ONGOING');
    expect(dueStatus(anEvent('PUBLISHED'), AT('2026-10-01T16:00:00Z'))).toBe('COMPLETED');
  });

  it('is inclusive at the opening instant of each window and exclusive at the close', () => {
    expect(dueStatus(anEvent('PUBLISHED'), AT('2026-10-01T09:59:59Z'))).toBe('PUBLISHED');
    expect(dueStatus(anEvent('PUBLISHED'), AT('2026-10-01T10:00:00Z'))).toBe('REGISTRATION_CLOSED');
    expect(dueStatus(anEvent('PUBLISHED'), AT('2026-10-01T11:00:00Z'))).toBe('ONGOING');
    expect(dueStatus(anEvent('PUBLISHED'), AT('2026-10-01T15:00:00Z'))).toBe('ONGOING');
  });

  it('never time-advances DRAFT, CANCELLED or CERTIFIED', () => {
    // Without this branch the sweep publishes every draft once its registration
    // window opens, and drags a cancelled event through the chain.
    for (const status of ['DRAFT', 'CANCELLED', 'CERTIFIED'] as const) {
      expect(dueStatus(anEvent(status), AT('2026-10-01T16:00:00Z'))).toBe(status);
    }
  });
});
