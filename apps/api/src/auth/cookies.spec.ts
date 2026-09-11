import { describe, expect, it } from 'vitest';
import { API_PREFIX } from '../config/api-prefix';
import {
  REFRESH_COOKIE_PATH,
  refreshCookieOptions,
  sessionCookieOptions,
} from './cookies';

describe('sessionCookieOptions', () => {
  it('sets Secure outside development', () => {
    // Catches: Secure hardcoded false for local convenience and shipped,
    // which sends the session cookie over plain HTTP in production.
    expect(sessionCookieOptions(true).secure).toBe(true);
  });

  it('leaves Secure off in development, so localhost works over http', () => {
    expect(sessionCookieOptions(false).secure).toBe(false);
  });

  it('is httpOnly and SameSite=Lax in both modes', () => {
    for (const opts of [sessionCookieOptions(true), sessionCookieOptions(false)]) {
      expect(opts.httpOnly).toBe(true);
      expect(opts.sameSite).toBe('lax');
    }
  });

  it('scopes the session cookie to the whole app, unlike the refresh cookie', () => {
    expect(sessionCookieOptions(true).path).toBe('/');
  });
});

describe('refreshCookieOptions', () => {
  it('scopes the refresh cookie to the auth routes only', () => {
    expect(refreshCookieOptions(true).path).toBe('/api/v1/auth');
  });

  it('is httpOnly and SameSite=Lax in both modes', () => {
    for (const opts of [refreshCookieOptions(true), refreshCookieOptions(false)]) {
      expect(opts.httpOnly).toBe(true);
      expect(opts.sameSite).toBe('lax');
    }
  });

  it('sets Secure outside development', () => {
    expect(refreshCookieOptions(true).secure).toBe(true);
    expect(refreshCookieOptions(false).secure).toBe(false);
  });
});

describe('REFRESH_COOKIE_PATH', () => {
  it('builds the refresh path from API_PREFIX rather than a literal', () => {
    // Catches a hardcoded '/api/v1/auth' that silently stops matching when
    // the prefix changes, at which point the browser stops sending the
    // refresh cookie and every session dies after 15 minutes.
    expect(REFRESH_COOKIE_PATH.startsWith(API_PREFIX)).toBe(true);
    expect(REFRESH_COOKIE_PATH).toBe('/api/v1/auth');
  });
});
