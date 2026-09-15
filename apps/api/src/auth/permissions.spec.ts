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

  it('denies user:suspend to a Club Lead: club authority is not platform authority', () => {
    // Catches: club rules treated as satisfying a platform-only rule, which
    // would let any club officer suspend platform users.
    expect(evaluate('user:suspend', { ...student, clubRoles: ['LEAD'] })).toBe(false);
  });

  it('denies an unknown permission rather than defaulting open', () => {
    // Catches: the classic fail-open bug: an unrecognised permission string
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
    // test of any other row would notice: this rule doesn't list ADMIN at
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

describe('Stage 4 permission rows', () => {
  const asClub = (roles: ActorFacts['clubRoles']): ActorFacts => ({ ...student, clubRoles: roles });
  const asEvent = (roles: ActorFacts['eventResponsibilities']): ActorFacts => ({
    ...student,
    eventResponsibilities: roles,
  });

  it('reserves club creation, status and Lead appointment to Admin', () => {
    for (const p of ['club:create', 'club:status', 'club:appoint-lead', 'department:manage'] as const) {
      expect(evaluate(p, admin)).toBe(true);
      // Catches a rule that listed `club: ['LEAD']` by copy and paste. A
      // Lead who can archive their own club or appoint their successor has
      // escaped the governance model entirely.
      expect(evaluate(p, asClub(['LEAD']))).toBe(false);
      expect(evaluate(p, student)).toBe(false);
    }
  });

  it('gives team management to Lead but not to Vice Lead', () => {
    // Catches `club: ['LEAD', 'VICE_LEAD']`, which spec 6.1 gives to
    // "Invite / end team appointments" for Lead only.
    expect(evaluate('club:team-manage', asClub(['LEAD']))).toBe(true);
    expect(evaluate('club:team-manage', asClub(['VICE_LEAD']))).toBe(false);
    expect(evaluate('club:team-manage', admin)).toBe(true);
  });

  it('gives membership decisions to Lead, Vice Lead and Operations only', () => {
    for (const role of ['LEAD', 'VICE_LEAD', 'OPERATIONS'] as const) {
      expect(evaluate('membership:decide', asClub([role]))).toBe(true);
    }
    // Catches a rule that admitted every club role. Marketing and CTO
    // deciding who joins is not in spec 6.1.
    expect(evaluate('membership:decide', asClub(['MARKETING']))).toBe(false);
    expect(evaluate('membership:decide', asClub(['CTO']))).toBe(false);
  });

  it('admits Marketing to club editing but never CTO', () => {
    // Stage 5 lifted Stage 4's deviation D4: Marketing reaches the route and
    // CLUB_FIELDS decides which keys of the body it may set. CTO stays out
    // entirely, because no column on Club is technical, so a CTO admitted
    // here would be refused by every field in the body.
    expect(evaluate('club:edit', asClub(['MARKETING']))).toBe(true);
    expect(evaluate('club:edit', asClub(['CTO']))).toBe(false);
    expect(evaluate('club:edit', asClub(['VICE_LEAD']))).toBe(true);
  });

  it('keeps event creation and cancellation narrower than event editing', () => {
    // Catches the easiest copy-paste slip in a matrix of five nearly
    // identical rows: giving every club role every event permission.
    expect(evaluate('event:edit', asClub(['OPERATIONS']))).toBe(true);
    expect(evaluate('event:create', asClub(['OPERATIONS']))).toBe(false);
    expect(evaluate('event:cancel', asClub(['VICE_LEAD']))).toBe(false);
    expect(evaluate('event:cancel', asClub(['LEAD']))).toBe(true);
    expect(evaluate('event:assign', asClub(['MARKETING']))).toBe(false);
  });

  it('grants attendee personal data to an assigned Operations officer and never to Marketing', () => {
    // Spec 6.1's "View attendee personal data" row: Operations gets it "for
    // assigned event", which is an EventAssignment, not a club appointment.
    expect(evaluate('registration:read', asClub(['OPERATIONS']))).toBe(false);
    expect(evaluate('registration:read', asEvent(['OPERATIONS']))).toBe(true);
    expect(evaluate('registration:read', asClub(['MARKETING']))).toBe(false);
    expect(evaluate('registration:read', asEvent(['MARKETING']))).toBe(false);
  });
});
