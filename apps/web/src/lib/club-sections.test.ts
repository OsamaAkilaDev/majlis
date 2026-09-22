import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CLUB_SECTION_ROLES, canCreateEvent, clubSectionsFor } from './club-sections';

const SOURCE = '../api/src/auth/permissions.ts';

/** The permission each section's screen is gated on, server-side. */
const NEEDED = {
  edit: 'club:edit',
  members: 'membership:decide',
  team: 'club:team-manage',
  reports: 'report:read',
} as const;

/** Parses one PERMISSIONS entry out of the API's own module: the mirror is
 *  only useful if it cannot silently drift from what the server enforces.
 *  Each entry is one brace pair with no nesting, so `[^}]*` is enough. */
function apiClubRoles(permission: string): string[] {
  const source = readFileSync(SOURCE, 'utf8');
  const entry = new RegExp(`'${permission}': \\{([^}]*)\\}`, 's').exec(source);
  if (!entry?.[1]) throw new Error(`${permission} is not in ${SOURCE}`);
  const club = /club: \[([^\]]*)\]/.exec(entry[1]);
  return (club?.[1] ?? '')
    .split(',')
    .map((r) => r.trim().replace(/'/g, ''))
    .filter((r) => r.length > 0);
}

describe('the section map', () => {
  it('matches the API permission by permission', () => {
    for (const [key, permission] of Object.entries(NEEDED)) {
      expect([key, CLUB_SECTION_ROLES[key as keyof typeof NEEDED]]).toEqual([
        key,
        apiClubRoles(permission),
      ]);
    }
  });

  it('reads a role list the API does carry, so an empty parse cannot pass the test above', () => {
    // Without this, a regex that matched nothing would make every bucket []
    // and the comparison would still hold for a section nobody can reach.
    expect(apiClubRoles('club:team-manage')).toEqual(['LEAD']);
  });
});

describe('clubSectionsFor', () => {
  it.each([
    ['LEAD', ['edit', 'members', 'team', 'reports']],
    ['VICE_LEAD', ['edit', 'members', 'reports']],
    ['OPERATIONS', ['members']],
    ['MARKETING', ['edit']],
    ['CTO', []],
  ] as const)('gives %s exactly its own sections', (role, expected) => {
    expect(clubSectionsFor([role], 'STUDENT').map((s) => s.key)).toEqual(expected);
  });

  it('gives a CTO nothing at all, so the Manage button is absent', () => {
    // The case that catches a gate written as "holds any club role": a CTO
    // holds one and reaches none of these four screens.
    expect(clubSectionsFor(['CTO'], 'STUDENT')).toHaveLength(0);
  });

  it('gives an ACTIVE member holding no role nothing', () => {
    expect(clubSectionsFor([], 'STUDENT')).toHaveLength(0);
  });

  it('gives an Admin holding no club role all four', () => {
    expect(clubSectionsFor([], 'ADMIN').map((s) => s.key)).toEqual([
      'edit',
      'members',
      'team',
      'reports',
    ]);
  });

  it('never offers certificates to anybody', () => {
    // certificate:manage is Admin-only with no club role, deliberately, so a
    // Lead cannot issue their own club's certificates. A row for it would
    // promise a screen the API refuses.
    for (const roles of [['LEAD'], ['VICE_LEAD'], ['MARKETING'], ['CTO'], ['OPERATIONS'], []]) {
      for (const platformRole of ['STUDENT', 'ADMIN'] as const) {
        expect(
          clubSectionsFor(roles as never, platformRole).map((s) => s.key),
        ).not.toContain('certificates');
      }
    }
  });
});

describe('canCreateEvent', () => {
  it('matches the API club roles for event:create', () => {
    expect(apiClubRoles('event:create')).toEqual(['LEAD', 'VICE_LEAD']);
  });

  it.each([
    ['LEAD', true],
    ['VICE_LEAD', true],
    ['MARKETING', false],
    ['CTO', false],
    ['OPERATIONS', false],
  ] as const)('answers %s with %s', (role, expected) => {
    expect(canCreateEvent([role], 'STUDENT')).toBe(expected);
  });

  it('gives an Admin holding no club role the control', () => {
    expect(canCreateEvent([], 'ADMIN')).toBe(true);
    expect(canCreateEvent([], 'STUDENT')).toBe(false);
  });
});
