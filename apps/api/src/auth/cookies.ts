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

export function sessionCookieOptions(isProduction: boolean): CookieOptions {
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    path: '/',
  };
}

export function refreshCookieOptions(isProduction: boolean): CookieOptions {
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    path: REFRESH_COOKIE_PATH,
  };
}
