import { describe, expect, it } from 'vitest';
import type { ActorFacts, Permission } from './permissions';
import { evaluate, matches } from './permissions';

const student: ActorFacts = {
  userId: 'u1',
  platformRole: 'STUDENT',
  clubRoles: [],
  eventResponsibilities: [],
};
const admin: ActorFacts = { ...student, platformRole: 'ADMIN' };

describe('evaluate', () => {
  it('grants user:suspend to an Admin', () => {
    // Catches: platform rule never checked, or ADMIN missing from the row.
    expect(evaluate('user:suspend', admin)).toBe(true);
  });

  it('denies user:suspend to a student', () => {
    // Catches: rule matched regardless of role (always-true evaluate).
    expect(evaluate('user:suspend', student)).toBe(false);
  });

  it('denies user:suspend to a Club Lead — club authority is not platform authority', () => {
    // Catches: club rules treated as satisfying a platform-only rule, which
    // would let any club officer suspend platform users.
    expect(evaluate('user:suspend', { ...student, clubRoles: ['LEAD'] })).toBe(false);
  });

  it('denies an unknown permission rather than defaulting open', () => {
    // Catches: the classic fail-open bug — an unrecognised permission string
    // (e.g. a typo in a @RequirePermission argument) falling through to
    // `true` instead of being denied. This is the one that matters most.
    expect(evaluate('nonexistent:action' as Permission, admin)).toBe(false);
  });
});

describe('matches', () => {
  it('has no implicit Admin superuser branch', () => {
    // Spec §6.1's "Register for an event" row reads "as student" in the
    // Admin column, not "override". A blanket
    // `if (platformRole === 'ADMIN') return true` shortcut would silently
    // grant the one permission the matrix deliberately withholds, and no
    // test of any other row would notice — this rule doesn't list ADMIN at
    // all, so it must deny an Admin.
    expect(matches({ club: ['LEAD'] }, admin)).toBe(false);
  });

  it('grants when the actor holds a listed club role', () => {
    // Catches: club array checked with the wrong actor field, or the
    // `.some` check inverted to require ALL listed roles.
    expect(matches({ club: ['LEAD', 'CTO'] }, { ...student, clubRoles: ['CTO'] })).toBe(true);
  });

  it('grants when the actor holds a listed event responsibility', () => {
    // Catches: the event branch missing entirely, or checking clubRoles
    // instead of eventResponsibilities.
    expect(
      matches({ event: ['OPERATIONS'] }, { ...student, eventResponsibilities: ['OPERATIONS'] }),
    ).toBe(true);
  });

  it('denies when no branch matches', () => {
    // Catches: any branch returning true unconditionally (e.g. `some`
    // called with no elements still short-circuiting to true), or the
    // final `false` fallthrough removed.
    expect(matches({ platform: ['ADMIN'], club: ['LEAD'], event: ['EVENT_LEAD'] }, student)).toBe(
      false,
    );
  });
});
