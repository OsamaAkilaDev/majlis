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

  it('allows leaving ARCHIVED for either live state', () => {
    // Archiving is reversible by decision (spec 3, 2026-09-16). Catches a
    // table that kept the old terminal rule, which strands a club archived
    // by a misclick with no route back.
    expect(() => assertTransition('ARCHIVED', 'ACTIVE')).not.toThrow();
    expect(() => assertTransition('ARCHIVED', 'SUSPENDED')).not.toThrow();
  });

  it('refuses a no-op transition from every state', () => {
    // Every state, not just ACTIVE: the no-op guard is the only rule left
    // that the now fully-connected table does not cover, so a table listing
    // a status in its own row would otherwise go unnoticed.
    expect(() => assertTransition('ACTIVE', 'ACTIVE')).toThrow();
    expect(() => assertTransition('SUSPENDED', 'SUSPENDED')).toThrow();
    expect(() => assertTransition('ARCHIVED', 'ARCHIVED')).toThrow();
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
