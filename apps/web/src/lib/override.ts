import type { ClubRole, SessionUser } from '@majlis/contracts';

/**
 * Mirrors `overrideReasonFor` in `apps/api/src/auth/field-permissions.ts`:
 * spec 6.1 asks a platform Admin holding no ACTIVE role in the club for a
 * recorded reason, and an Admin who does hold one is acting in that capacity
 * rather than overriding.
 *
 * Presentation only. It decides whether a screen shows the reason control;
 * the server re-derives the same decision from the database per request and
 * refuses a missing reason whatever the screen sent.
 */
export function needsOverrideReason(
  platformRole: SessionUser['platformRole'],
  viewerClubRoles: readonly ClubRole[],
): boolean {
  return platformRole === 'ADMIN' && viewerClubRoles.length === 0;
}
