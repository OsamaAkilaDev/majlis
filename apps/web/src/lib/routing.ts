import type { SessionUser } from '@majlis/contracts';
import { enumLabel } from './enum-label';

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
  if (user.platformRole === 'ADMIN') return '/admin';
  const clubIds = user.clubRoles.map((r) => r.clubId).sort();
  const first = clubIds[0];
  return first ? `/manage/${first}` : '/home';
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

export function shellDestinations(user: SessionUser): ShellDestination[] {
  const destinations: ShellDestination[] = [];
  if (user.platformRole === 'ADMIN') destinations.push({ href: '/admin', label: 'Admin' });

  const clubs = [...user.clubRoles].sort((a, b) => a.clubId.localeCompare(b.clubId));
  for (const { clubId, clubName, role } of clubs) {
    destinations.push({
      href: `/manage/${clubId}/overview`,
      label: clubName,
      meta: enumLabel(role),
    });
  }

  destinations.push({ href: '/home', label: 'Home' });
  return destinations;
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
