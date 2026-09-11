import type { CookieOptions } from 'express';

export const SESSION_COOKIE = 'majlis_session';
export const REFRESH_COOKIE = 'majlis_refresh';

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
 * `NODE_ENV === 'production'` independently — a staging deploy running with
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
