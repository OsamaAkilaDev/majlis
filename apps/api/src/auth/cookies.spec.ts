import { describe, expect, it } from 'vitest';
import {
  REFRESH_COOKIE_PATH,
  refreshCookieOptions,
  secureCookies,
  sessionCookieOptions,
} from './cookies';

describe('secureCookies', () => {
  it('is false in development, so localhost works over http', () => {
    expect(secureCookies('development')).toBe(false);
  });

  it('is true in production', () => {
    expect(secureCookies('production')).toBe(true);
  });

  it('is true in test — a staging deploy running NODE_ENV=test must still ship Secure cookies', () => {
    // Catches the pre-fix `NODE_ENV === 'production'` check: it satisfies
    // neither 'test' nor any other non-development value, so a staging
    // deploy running with NODE_ENV=test would ship the session cookie
    // without Secure, over plain HTTP.
    expect(secureCookies('test')).toBe(true);
  });

  it('is true for any value that is not literally "development"', () => {
    expect(secureCookies('staging')).toBe(true);
  });
});

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
  it('scopes the refresh cookie to the site root, so middleware sees it on page navigations', () => {
    expect(refreshCookieOptions(true).path).toBe('/');
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
  // Widened from `${API_PREFIX}/auth` to '/' in Stage 3. A path-scoped refresh
  // cookie is not sent on a page navigation, so Next.js middleware cannot see
  // it and redirects a user with a valid 30-day session to /login after the
  // 15-minute session cookie expires. This test pins the widening so a later
  // "tighten the cookie path" cleanup fails loudly instead of silently
  // breaking navigation for every signed-in user.
  it('is the site root so middleware receives it on page navigations', () => {
    expect(REFRESH_COOKIE_PATH).toBe('/');
  });
});
