import type { SessionUser } from '@majlis/contracts';

/**
 * The API adds the `__Host-` prefix to both cookies in production only (see
 * `apps/api/src/auth/cookies.ts`); the prefix needs HTTPS, and the dev loop
 * and Playwright both run over HTTP. Derived the same way here, so middleware
 * looks for the names the API actually set.
 */
const HOST_PREFIX = process.env.NODE_ENV === 'production' ? '__Host-' : '';

export const SESSION_COOKIE = `${HOST_PREFIX}majlis_session`;
export const REFRESH_COOKIE = `${HOST_PREFIX}majlis_refresh`;

/** Routes reachable with no account at all. */
const PUBLIC_PREFIXES = ['/verify'];

/**
 * Routes that exist to sign in, and must bounce an already-signed-in visitor.
 *
 * The two reset routes belong here, not among the protected ones: somebody
 * asking for a reset link cannot sign in by definition, so gating them sends
 * exactly the visitor who needs them to the form they are locked out of.
 * /login and /signup call `bounceIfSignedIn` themselves, using a session they
 * validated; the reset routes stay reachable with a live session, because a
 * visitor signed in on this device may still hold a link for another.
 */
const AUTH_ROUTES = ['/login', '/signup', '/forgot-password', '/reset-password'];

export function landingFor(user: SessionUser): string {
  if (user.platformRole === 'ADMIN') return '/admin';
  const clubIds = user.clubRoles.map((r) => r.clubId).sort();
  const first = clubIds[0];
  return first ? `/manage/${first}` : '/home';
}

/** The nav destination a path belongs to: the longest href that is a prefix of
 *  it, so `/me` owns `/me/registrations` while `/me/qr` keeps its own entry, and
 *  a console's `.../events` stays lit on `.../events/{id}`. Shared by the tab
 *  bar and both side navs so a deep route cannot light nothing in one of them. */
export function activeNavHref(pathname: string, hrefs: readonly string[]): string | null {
  let best: string | null = null;
  for (const href of hrefs) {
    if (!isUnder(pathname, href)) continue;
    if (best === null || href.length > best.length) best = href;
  }
  return best;
}

export type ShellDestination = { href: string; label: string };

/** Every shell this viewer may reach, derived from the session the server
 *  already fetched. A club ID from the browser is a claim, never a destination. */
export function shellDestinations(user: SessionUser): ShellDestination[] {
  const destinations: ShellDestination[] = [];
  if (user.platformRole === 'ADMIN') destinations.push({ href: '/admin', label: 'Admin' });

  const clubs = [...user.clubRoles].sort((a, b) => a.clubId.localeCompare(b.clubId));
  for (const { clubId, role } of clubs) {
    // Club names arrive in Stage 4; the session carries only the role today.
    const label = role.charAt(0) + role.slice(1).toLowerCase().replace(/_/g, ' ');
    destinations.push({ href: `/manage/${clubId}/overview`, label });
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

  // A missing session cookie with a live refresh cookie is a refreshable
  // session, not an anonymous visitor. Middleware renews it in place.
  const signedIn = hasSession || hasRefresh;

  // An auth route is never bounced from here. A cookie's PRESENCE is not a
  // session: a dead one sent /login to / while the server sent / back to
  // /login, looping forever. /login and /signup bounce a genuinely signed-in
  // visitor themselves, using a validated session, which is the only copy of
  // this decision that can tell the difference.
  if (AUTH_ROUTES.includes(pathname)) return null;
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
