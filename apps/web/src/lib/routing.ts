import type { SessionUser } from '@majlis/contracts';

// The API adds `__Host-` in production only (apps/api/src/auth/cookies.ts);
// the prefix needs HTTPS and the dev loop runs over HTTP. Derived the same way
// here so middleware looks for the names the API actually set.
const HOST_PREFIX = process.env.NODE_ENV === 'production' ? '__Host-' : '';

export const SESSION_COOKIE = `${HOST_PREFIX}majlis_session`;
export const REFRESH_COOKIE = `${HOST_PREFIX}majlis_refresh`;

const PUBLIC_PREFIXES = ['/verify'];

// Never bounced from middleware. /setup would loop: on a deployment with no
// admin, /login redirects to it and gating it sends the visitor back. The
// reset routes must stay reachable with a live session, since a visitor signed
// in here may hold a link for another device.
const AUTH_ROUTES = ['/login', '/signup', '/setup', '/forgot-password', '/reset-password'];

export function landingFor(user: SessionUser): string {
  return user.platformRole === 'ADMIN' ? '/admin' : '/events';
}

/** The longest href that is a prefix of `pathname`, so a deep route lights the
 *  nearest entry rather than nothing. Shared by the tab bar and both side navs. */
export function activeNavHref(pathname: string, hrefs: readonly string[]): string | null {
  let best: string | null = null;
  for (const href of hrefs) {
    if (!isUnder(pathname, href)) continue;
    if (best === null || href.length > best.length) best = href;
  }
  return best;
}

export type ShellDestination = { href: string; label: string; meta?: string };

/** At most one entry. A club is reached from the Clubs tab, where the viewer's
 *  own sit at the top wearing their role, so a switcher listing them again is
 *  a second route to the same place. */
export function shellDestinations(user: SessionUser): ShellDestination[] {
  return user.platformRole === 'ADMIN' ? [{ href: '/admin', label: 'Admin' }] : [];
}

/** Where a viewer of the club console belongs instead, or null if they belong
 *  there. The console is Admin-only as of Stage 9; an officer does their work
 *  inside the application, on the club page itself. */
export function consoleRedirect(user: SessionUser, clubSlug: string | null): string | null {
  if (user.platformRole === 'ADMIN') return null;
  return clubSlug ? `/clubs/${clubSlug}` : '/clubs';
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

  // A refresh cookie without a session cookie is a renewable session, not an
  // anonymous visitor: middleware renews it in place.
  const signedIn = hasSession || hasRefresh;

  // A cookie's PRESENCE is not a session. A dead one sent /login to / while the
  // server sent / back to /login, forever. /login and /signup bounce a real
  // session themselves, from a validated one.
  if (AUTH_ROUTES.includes(pathname)) return null;
  return signedIn ? null : { to: '/login' };
}

export function mergeSessionCookie(cookieHeader: string, setCookies: string[]): string {
  const sessionSetCookie = setCookies.find((c) => c.trim().startsWith(`${SESSION_COOKIE}=`));
  if (!sessionSetCookie) return cookieHeader;

  // Attributes belong on Set-Cookie, never on the request's Cookie header.
  const pair = sessionSetCookie.split(';')[0]?.trim() ?? '';

  const kept = cookieHeader
    .split(';')
    .map((p) => p.trim())
    .filter((p) => p.length > 0 && !p.startsWith(`${SESSION_COOKIE}=`));

  return [...kept, pair].join('; ');
}
