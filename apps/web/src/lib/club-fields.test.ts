import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CLUB_FIELD_ROLES, canEditClubField } from './club-fields';

const SOURCE = '../api/src/auth/field-permissions.ts';

/** Parses `CLUB_FIELDS` out of the API's own module: the mirror is only useful
 *  if it cannot silently drift from what the server enforces. */
function apiClubFields(): Record<string, string[]> {
  const source = readFileSync(SOURCE, 'utf8');
  const block = /export const CLUB_FIELDS = \{([\s\S]*?)\n\} as const/.exec(source);
  if (!block?.[1]) throw new Error(`CLUB_FIELDS is not in ${SOURCE}`);

  const map: Record<string, string[]> = {};
  for (const [, field, roles] of block[1].matchAll(/^ {2}(\w+): \[([^\]]*)\],$/gm)) {
    map[field!] = (roles ?? '')
      .split(',')
      .map((r) => r.trim().replace(/'/g, ''))
      .filter((r) => r.length > 0);
  }
  return map;
}

describe('the field map', () => {
  it('matches the API field by field, bucket by bucket', () => {
    expect(CLUB_FIELD_ROLES).toEqual(apiClubFields());
  });
});

describe('canEditClubField', () => {
  it('gives a Marketing officer the two fields they hold, and no others', () => {
    // The profile used to gate on Lead/Vice/Admin alone, which refused a
    // Marketing officer the description the API lets them write.
    expect(canEditClubField('description', ['MARKETING'], 'STUDENT')).toBe(true);
    expect(canEditClubField('category', ['MARKETING'], 'STUDENT')).toBe(true);
    expect(canEditClubField('membershipPolicy', ['MARKETING'], 'STUDENT')).toBe(false);
    expect(canEditClubField('departmentId', ['MARKETING'], 'STUDENT')).toBe(false);
  });

  it('gives an Operations or CTO officer nothing on the profile', () => {
    expect(canEditClubField('description', ['OPERATIONS'], 'STUDENT')).toBe(false);
    expect(canEditClubField('category', ['CTO'], 'STUDENT')).toBe(false);
  });

  it('gives Lead and Vice the bucket nobody else holds', () => {
    expect(canEditClubField('membershipPolicy', ['LEAD'], 'STUDENT')).toBe(true);
    expect(canEditClubField('departmentId', ['VICE_LEAD'], 'STUDENT')).toBe(true);
  });

  it('gives an Admin holding no club role every field', () => {
    expect(canEditClubField('departmentId', [], 'ADMIN')).toBe(true);
  });

  it('gives someone with no role at all nothing', () => {
    expect(canEditClubField('description', [], 'STUDENT')).toBe(false);
  });
});
