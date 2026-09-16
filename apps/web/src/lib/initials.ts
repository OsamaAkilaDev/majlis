/**
 * "Layla Al Mansoori" -> "LA". What an avatar shows when there is no image.
 *
 * In its own module rather than beside the avatar button because the profile
 * screen renders the same fallback from a Server Component, and importing a
 * function from a 'use client' module into one yields a client reference
 * object, not the function (see `page-size.ts` for where that bit before).
 */
export function initials(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  return parts.slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('') || '?';
}
