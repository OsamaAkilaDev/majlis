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

/** Rewrites a request's `cookie` header so the just-renewed session cookie is
 *  visible to the current render, not only to the next request. */
export function mergeSessionCookie(cookieHeader: string, setCookies: string[]): string {
  const sessionSetCookie = setCookies.find((c) => c.trim().startsWith(`${SESSION_COOKIE}=`));
  if (!sessionSetCookie) return cookieHeader;

  // Attributes (Path, HttpOnly, Max-Age, ...) belong on Set-Cookie, never on
  // the request's Cookie header, so only the name=value pair survives.
  const pair = sessionSetCookie.split(';')[0]?.trim() ?? '';

  const kept = cookieHeader
    .split(';')
    .map((p) => p.trim())
    .filter((p) => p.length > 0 && !p.startsWith(`${SESSION_COOKIE}=`));

  return [...kept, pair].join('; ');
}
