/** "Layla Al Mansoori" -> "LA". Its own module, with no 'use client', because
 *  a Server Component renders the same fallback (see `page-size.ts`). */
export function initials(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  return parts.slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('') || '?';
}
