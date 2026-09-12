import { describe, expect, it } from 'vitest';
import { ForbiddenError } from '../common/problem/domain-error';
import { CLUB_FIELDS, EVENT_FIELDS, assertFieldsAllowed } from './field-permissions';
import type { ActorFacts, ClubRole, PlatformRole } from './permissions';

function facts(clubRoles: ClubRole[], platformRole: PlatformRole = 'STUDENT'): Pick<ActorFacts, 'platformRole' | 'clubRoles'> {
  return { platformRole, clubRoles };
}

describe('assertFieldsAllowed', () => {
  it('lets a club Marketing officer edit the description but not the membership policy', () => {
    // `club:edit` now admits MARKETING at the route, so this map is the only
    // thing standing between a Marketing officer and the club's membership
    // policy. Both halves are needed: a map that refused everything would
    // pass the second assertion alone.
    expect(() => assertFieldsAllowed({ description: 'x' }, CLUB_FIELDS, facts(['MARKETING']))).not.toThrow();
    expect(() => assertFieldsAllowed({ membershipPolicy: 'OPEN' }, CLUB_FIELDS, facts(['MARKETING']))).toThrow(
      'You do not have permission to change membershipPolicy.',
    );
  });

  it('keeps each event bucket to its own fields', () => {
    expect(() => assertFieldsAllowed({ title: 'x' }, EVENT_FIELDS, facts(['MARKETING']))).not.toThrow();
    expect(() => assertFieldsAllowed({ capacity: 5 }, EVENT_FIELDS, facts(['MARKETING']))).toThrow(ForbiddenError);

    expect(() => assertFieldsAllowed({ capacity: 5 }, EVENT_FIELDS, facts(['OPERATIONS']))).not.toThrow();
    expect(() => assertFieldsAllowed({ certificateEnabled: true }, EVENT_FIELDS, facts(['OPERATIONS']))).toThrow(
      ForbiddenError,
    );

    expect(() => assertFieldsAllowed({ timezone: 'UTC' }, EVENT_FIELDS, facts(['CTO']))).not.toThrow();
    expect(() => assertFieldsAllowed({ startsAt: 'x' }, EVENT_FIELDS, facts(['CTO']))).toThrow(ForbiddenError);
  });

  it('refuses the empty buckets to every officer but Lead, Vice and Admin', () => {
    for (const role of ['MARKETING', 'CTO', 'OPERATIONS'] as const) {
      expect(() => assertFieldsAllowed({ startsAt: 'x' }, EVENT_FIELDS, facts([role]))).toThrow(ForbiddenError);
    }
    expect(() => assertFieldsAllowed({ startsAt: 'x' }, EVENT_FIELDS, facts(['LEAD']))).not.toThrow();
    expect(() => assertFieldsAllowed({ startsAt: 'x' }, EVENT_FIELDS, facts(['VICE_LEAD']))).not.toThrow();
    expect(() => assertFieldsAllowed({ startsAt: 'x' }, EVENT_FIELDS, facts([], 'ADMIN'))).not.toThrow();
  });

  it('refuses a key that is in no bucket at all', () => {
    // Fail closed. A field added to patchEventBodySchema without a decision
    // recorded in EVENT_FIELDS must not fall through to whoever holds the
    // route permission.
    expect(() => assertFieldsAllowed({ confirmedCount: 99 }, EVENT_FIELDS, facts(['OPERATIONS']))).toThrow(
      'You do not have permission to change confirmedCount.',
    );
  });
});
