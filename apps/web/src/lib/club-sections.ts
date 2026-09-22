import type { ClubRole, SessionUser } from '@majlis/contracts';

/**
 * A mirror of PERMISSIONS in `apps/api/src/auth/permissions.ts`, kept honest by
 * club-sections.test.ts, which parses that file and compares.
 *
 * Presentation only: it decides which rows the Manage sheet offers. The server
 * re-derives the same decision from the database and is the protection.
 */
export type ClubSectionKey = 'edit' | 'members' | 'team' | 'reports';

/**
 * The `club` array of the permission each section needs.
 *
 * Certificates is deliberately not a section. `certificate:manage` carries no
 * club role at all, so offering a Lead that row promises a screen the API
 * refuses.
 */
export const CLUB_SECTION_ROLES = {
  edit: ['LEAD', 'VICE_LEAD', 'MARKETING'],
  members: ['LEAD', 'VICE_LEAD', 'OPERATIONS'],
  team: ['LEAD'],
  reports: ['LEAD', 'VICE_LEAD'],
} as const satisfies Record<ClubSectionKey, readonly ClubRole[]>;

export interface ClubSection {
  key: ClubSectionKey;
  label: string;
  /** Appended to `/clubs/{slug}/`. */
  path: string;
}

const SECTIONS: ClubSection[] = [
  { key: 'edit', label: 'Edit club', path: 'edit' },
  { key: 'members', label: 'Members', path: 'members' },
  { key: 'team', label: 'Team', path: 'team' },
  { key: 'reports', label: 'Reports', path: 'reports' },
];

export function clubSectionsFor(
  clubRoles: readonly ClubRole[],
  platformRole: SessionUser['platformRole'],
): ClubSection[] {
  if (platformRole === 'ADMIN') return SECTIONS;
  return SECTIONS.filter((s) => CLUB_SECTION_ROLES[s.key].some((r) => clubRoles.includes(r)));
}

/** `event:create` needs the whole object, including startsAt, which no field
 *  bucket gives Marketing, CTO or Operations. */
export function canCreateEvent(
  clubRoles: readonly ClubRole[],
  platformRole: SessionUser['platformRole'],
): boolean {
  return (
    platformRole === 'ADMIN' || clubRoles.includes('LEAD') || clubRoles.includes('VICE_LEAD')
  );
}
