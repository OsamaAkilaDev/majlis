import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { EVENT_FIELD_ROLES, canEditEventField } from './event-fields';

const SOURCE = '../api/src/auth/field-permissions.ts';

/** Parses `EVENT_FIELDS` out of the API's own module: the mirror is only
 *  useful if it cannot silently drift from what the server enforces. */
function apiEventFields(): Record<string, string[]> {
  const source = readFileSync(SOURCE, 'utf8');
  const block = /export const EVENT_FIELDS = \{([\s\S]*?)\n\} as const/.exec(source);
  if (!block?.[1]) throw new Error(`EVENT_FIELDS is not in ${SOURCE}`);

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
    expect(EVENT_FIELD_ROLES).toEqual(apiEventFields());
  });
});

describe('canEditEventField', () => {
  it('holds a Marketing officer to the marketing bucket', () => {
    expect(canEditEventField('title', ['MARKETING'], 'STUDENT')).toBe(true);
    expect(canEditEventField('capacity', ['MARKETING'], 'STUDENT')).toBe(false);
    expect(canEditEventField('startsAt', ['MARKETING'], 'STUDENT')).toBe(false);
  });

  it('holds an Operations officer to the operations bucket', () => {
    expect(canEditEventField('capacity', ['OPERATIONS'], 'STUDENT')).toBe(true);
    expect(canEditEventField('title', ['OPERATIONS'], 'STUDENT')).toBe(false);
  });

  it('gives Lead and Vice every field, including the bucket nobody else holds', () => {
    expect(canEditEventField('startsAt', ['LEAD'], 'STUDENT')).toBe(true);
    expect(canEditEventField('slug', ['VICE_LEAD'], 'STUDENT')).toBe(true);
  });

  it('gives an Admin holding no club role every field', () => {
    expect(canEditEventField('startsAt', [], 'ADMIN')).toBe(true);
  });

  it('gives someone with no role at all nothing', () => {
    expect(canEditEventField('title', [], 'STUDENT')).toBe(false);
  });
});
