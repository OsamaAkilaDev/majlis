import { describe, expect, it } from 'vitest';
import { assertAcceptsEdits, assertAcceptsNewActivity, assertTransition } from './club-status';

describe('assertTransition', () => {
  it('allows ACTIVE and SUSPENDED in both directions', () => {
    expect(() => assertTransition('ACTIVE', 'SUSPENDED')).not.toThrow();
    expect(() => assertTransition('SUSPENDED', 'ACTIVE')).not.toThrow();
  });

  it('allows archiving from either live state', () => {
    expect(() => assertTransition('ACTIVE', 'ARCHIVED')).not.toThrow();
    expect(() => assertTransition('SUSPENDED', 'ARCHIVED')).not.toThrow();
  });

  it('refuses every transition out of ARCHIVED', () => {
    // ARCHIVED is terminal. Catches a table built from the allowed pairs
    // without the terminal rule, which would let an admin quietly revive an
    // archived club and its entire history.
    expect(() => assertTransition('ARCHIVED', 'ACTIVE')).toThrow();
    expect(() => assertTransition('ARCHIVED', 'SUSPENDED')).toThrow();
    expect(() => assertTransition('ARCHIVED', 'ARCHIVED')).toThrow();
  });

  it('refuses a no-op transition', () => {
    expect(() => assertTransition('ACTIVE', 'ACTIVE')).toThrow();
  });
});

describe('activity gates', () => {
  it('blocks new activity in a suspended club but still allows edits', () => {
    // Spec 6.2: a suspended club freezes new memberships and events, while
    // officers keep their appointments and can still edit the profile.
    // Catches one combined gate used for both, which either blocks editing
    // a suspended club or admits new members to one.
    expect(() => assertAcceptsNewActivity('SUSPENDED')).toThrow();
    expect(() => assertAcceptsEdits('SUSPENDED')).not.toThrow();
  });

  it('blocks both in an archived club', () => {
    expect(() => assertAcceptsNewActivity('ARCHIVED')).toThrow();
    expect(() => assertAcceptsEdits('ARCHIVED')).toThrow();
  });

  it('allows both in an active club', () => {
    expect(() => assertAcceptsNewActivity('ACTIVE')).not.toThrow();
    expect(() => assertAcceptsEdits('ACTIVE')).not.toThrow();
  });
});
