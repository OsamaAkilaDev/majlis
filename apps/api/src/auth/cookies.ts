import type { CookieOptions } from 'express';

/**
 * The `__Host-` prefix a browser refuses to accept on any cookie that is not
 * Secure, Path=/ and free of a Domain attribute. Both cookies already are all
 * three, and the prefix is what stops a sibling subdomain from overwriting
 * either of them.
 *
 * Production only, because it requires HTTPS and both the dev loop and
 * Playwright run over plain HTTP, where a prefixed cookie is silently
 * dropped and nobody can sign in. `apps/web/src/lib/routing.ts` derives the
 * same two names the same way; the halves must agree or middleware stops
 * seeing the session.
 */
export function hostPrefix(nodeEnv: string | undefined): string {
  return nodeEnv === 'production' ? '__Host-' : '';
}

const PREFIX = hostPrefix(process.env.NODE_ENV);

export const SESSION_COOKIE = `${PREFIX}majlis_session`;
export const REFRESH_COOKIE = `${PREFIX}majlis_refresh`;

/**
 * The site root, not `${API_PREFIX}/auth`. A path-scoped cookie is not sent on
 * a page navigation, so Next.js middleware could not see it and would redirect
 * a user with a valid 30-day session to /login after 15 minutes. Widening it
 * lets middleware refresh the session in place. The token stays httpOnly,
 * Secure, SameSite=Lax and opaque, and is stored only as a SHA-256 hash.
 */
export const REFRESH_COOKIE_PATH = '/';

/**
 * Design spec (§3): Secure whenever `NODE_ENV !== 'development'`, not only in
 * `'production'`. The two callers in auth.controller.ts each computed
 * `NODE_ENV === 'production'` independently. A staging deploy running with
 * `NODE_ENV=test` (a real, common setup) would satisfy neither branch and
 * ship the session and refresh cookies without Secure, over plain HTTP.
 * Centralised here so both call sites derive it from the same rule rather
 * than each re-deriving (and each risking drifting from) it.
 */
export function secureCookies(nodeEnv: string): boolean {
  return nodeEnv !== 'development';
}

export function sessionCookieOptions(secure: boolean): CookieOptions {
  return {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/',
  };
}

export function refreshCookieOptions(secure: boolean): CookieOptions {
  return {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: REFRESH_COOKIE_PATH,
  };
}
