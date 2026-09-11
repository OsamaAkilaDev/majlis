import type { SessionUser } from '@majlis/contracts';

export const SESSION_COOKIE = 'majlis_session';
export const REFRESH_COOKIE = 'majlis_refresh';

/** Routes reachable with no account at all. */
const PUBLIC_PREFIXES = ['/verify'];

/** Routes that exist to sign in, and must bounce an already-signed-in visitor. */
const AUTH_ROUTES = ['/login', '/signup'];

export function landingFor(user: SessionUser): string {
  if (user.platformRole === 'ADMIN') return '/admin';
  const clubIds = user.clubRoles.map((r) => r.clubId).sort();
  const first = clubIds[0];
  return first ? `/manage/${first}` : '/home';
}

function isUnder(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export function decideRedirect(input: {
  pathname: string;
  hasSession: boolean;
  hasRefresh: boolean;
}): { to: string } | null {
  const { pathname, hasSession, hasRefresh } = input;

  if (PUBLIC_PREFIXES.some((p) => isUnder(pathname, p))) return null;

  // A missing session cookie with a live refresh cookie is a refreshable
  // session, not an anonymous visitor. Middleware renews it in place.
  const signedIn = hasSession || hasRefresh;

  if (AUTH_ROUTES.includes(pathname)) return signedIn ? { to: '/' } : null;
  return signedIn ? null : { to: '/login' };
}
