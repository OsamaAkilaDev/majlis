import type { CookieOptions } from 'express';
import { API_PREFIX } from '../config/api-prefix';

export const SESSION_COOKIE = 'majlis_session';
export const REFRESH_COOKIE = 'majlis_refresh';

/**
 * Built from API_PREFIX rather than written as a literal: a hardcoded
 * '/api/v1/auth' would silently stop matching if the prefix ever changes,
 * the browser would stop sending the refresh cookie, and every session
 * would die after 15 minutes with no error anywhere.
 */
export const REFRESH_COOKIE_PATH = `${API_PREFIX}/auth`;

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
