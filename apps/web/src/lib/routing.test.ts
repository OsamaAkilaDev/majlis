import { describe, expect, it } from 'vitest';
import type { SessionUser } from '@majlis/contracts';
import {
  activeNavHref,
  consoleRedirect,
  decideRedirect,
  landingFor,
  mergeSessionCookie,
  shellDestinations,
} from './routing';

const user = (over: Partial<SessionUser> = {}): SessionUser => ({
  id: 'u1',
  email: 'a@uni.ac.ae',
  fullName: 'A Student',
  avatarUrl: null,
  platformRole: 'STUDENT',
  clubRoles: [],
  ...over,
});

describe('landingFor', () => {
  it('sends every non-admin to events, officer or not', () => {
    expect(landingFor(user())).toBe('/events');
    expect(landingFor(user({ clubRoles: [{ clubId: 'c1', clubName: 'Robotics', role: 'LEAD' }] })))
      .toBe('/events');
    expect(landingFor(user({ platformRole: 'ADMIN' }))).toBe('/admin');
  });
});

describe('decideRedirect', () => {
  const anon = { hasSession: false, hasRefresh: false };
  const live = { hasSession: true, hasRefresh: true };
  const stale = { hasSession: false, hasRefresh: true };

  it('sends an anonymous visitor from a protected route to /login', () => {
    expect(decideRedirect({ pathname: '/home', ...anon })).toEqual({ to: '/login' });
  });

  it('lets a signed-in visitor through a protected route', () => {
    expect(decideRedirect({ pathname: '/home', ...live })).toBeNull();
  });

  it('lets a stale-session visitor through so middleware can refresh', () => {
    // Catches treating a missing session cookie as anonymous: that logs out
    // every user after 15 idle minutes despite a valid 30-day refresh token.
    expect(decideRedirect({ pathname: '/home', ...stale })).toBeNull();
  });

  it('never bounces a visitor off /login, however signed-in their cookies look', () => {
    // Catches ERR_TOO_MANY_REDIRECTS: a rejected cookie still makes hasSession
    // true, so bouncing /login to / meant / redirected back forever. Restore
    // `signedIn ? { to: '/' }` and this goes red.
    expect(decideRedirect({ pathname: '/login', ...live })).toBeNull();
    expect(decideRedirect({ pathname: '/signup', ...live })).toBeNull();
    expect(decideRedirect({ pathname: '/login', ...stale })).toBeNull();
  });

  it('leaves an anonymous visitor on /login', () => {
    expect(decideRedirect({ pathname: '/login', ...anon })).toBeNull();
  });

  it('never gates /setup, which exists to create the account that signs you in', () => {
    // The same loop in the one state no seeded test reaches: with no admin,
    // /login redirects to /setup, and gating /setup bounces back forever,
    // leaving the only screen that creates an admin unreachable. Drop '/setup'
    // from AUTH_ROUTES and this goes red.
    expect(decideRedirect({ pathname: '/setup', ...anon })).toBeNull();
    // Presence is not a session: /setup validates one itself before deciding.
    expect(decideRedirect({ pathname: '/setup', ...stale })).toBeNull();
    expect(decideRedirect({ pathname: '/setup', ...live })).toBeNull();
  });

  it('never gates the password reset routes, signed in or not', () => {
    // Somebody asking for a reset link cannot sign in by definition: gating
    // these makes the reset flow unreachable in production.
    expect(decideRedirect({ pathname: '/forgot-password', ...anon })).toBeNull();
    expect(decideRedirect({ pathname: '/reset-password', ...anon })).toBeNull();
    // Nor a live session: the link requested on a phone is opened on a laptop
    // its holder is still signed in on.
    expect(decideRedirect({ pathname: '/reset-password', ...live })).toBeNull();
    expect(decideRedirect({ pathname: '/forgot-password', ...live })).toBeNull();
  });

  it('never gates public certificate verification', () => {
    // /verify is opened by an employer with no account at all.
    expect(decideRedirect({ pathname: '/verify/ABC123', ...anon })).toBeNull();
  });

  it('does not treat /loginary as the login route', () => {
    // Catches pathname.startsWith('/login'), which misroutes any path merely
    // beginning with those characters.
    expect(decideRedirect({ pathname: '/loginary', ...anon })).toEqual({ to: '/login' });
  });

  it('does not treat /verifyfoo as the public verify route', () => {
    // Catches startsWith on PUBLIC_PREFIXES, which leaves any path beginning
    // with those characters ungated.
    expect(decideRedirect({ pathname: '/verifyfoo', ...anon })).toEqual({ to: '/login' });
  });

  it('leaves the bare /verify route public', () => {
    expect(decideRedirect({ pathname: '/verify', ...anon })).toBeNull();
  });
});

describe('mergeSessionCookie', () => {
  it('replaces an existing majlis_session pair', () => {
    const result = mergeSessionCookie('majlis_session=old; majlis_refresh=abc', [
      'majlis_session=new; Path=/; HttpOnly; Max-Age=900',
    ]);
    expect(result).toBe('majlis_refresh=abc; majlis_session=new');
    // Catches appending instead of replacing, which leaves both the expired
    // and the renewed value on the header.
    expect(result.match(/majlis_session=/g)).toHaveLength(1);
  });

  it('appends when majlis_session is absent', () => {
    const result = mergeSessionCookie('majlis_refresh=abc', [
      'majlis_session=new; Path=/; HttpOnly',
    ]);
    expect(result).toBe('majlis_refresh=abc; majlis_session=new');
  });

  it('ignores a majlis_refresh Set-Cookie entry', () => {
    // Catches merging the first Set-Cookie regardless of name, which leaks the
    // refresh value into the session cookie's slot.
    const result = mergeSessionCookie('majlis_session=old', [
      'majlis_refresh=newrefresh; Path=/; HttpOnly',
    ]);
    expect(result).toBe('majlis_session=old');
  });

  it('strips attributes so Path, HttpOnly and Max-Age never leak into the cookie header', () => {
    const result = mergeSessionCookie('majlis_refresh=abc', [
      'majlis_session=new; Path=/; HttpOnly; Max-Age=900; SameSite=Lax',
    ]);
    expect(result).not.toMatch(/Path|HttpOnly|Max-Age|SameSite/);
  });
});

describe('shellDestinations', () => {
  it('gives a club officer no shell destination at all', () => {
    expect(shellDestinations(user({ clubRoles: [{ clubId: 'c1', clubName: 'Robotics', role: 'LEAD' }] })))
      .toEqual([]);
  });

  it('gives an admin exactly one', () => {
    expect(shellDestinations(user({ platformRole: 'ADMIN' }))).toEqual([
      { href: '/admin', label: 'Admin' },
    ]);
  });
});

describe('consoleRedirect', () => {
  it('sends a club officer out of the console and leaves an admin in it', () => {
    const lead = user({ clubRoles: [{ clubId: 'c1', clubName: 'Robotics', role: 'LEAD' }] });
    expect(consoleRedirect(lead, 'robotics')).toBe('/clubs/robotics');
    expect(consoleRedirect(user({ platformRole: 'ADMIN' }), 'robotics')).toBeNull();
  });

  it('sends an officer to the club list when the club could not be read', () => {
    expect(consoleRedirect(user(), null)).toBe('/clubs');
  });
});

describe('activeNavHref', () => {
  const TABS = ['/events', '/clubs', '/profile/qr'];

  it('lights the tab for its own route', () => {
    expect(activeNavHref('/events', TABS)).toBe('/events');
    expect(activeNavHref('/profile/qr', TABS)).toBe('/profile/qr');
  });

  it('lights a tab on its deep routes', () => {
    // Catches an exact match, which left a club page and an event page with no
    // tab lit at all.
    expect(activeNavHref('/clubs/robotics-club', TABS)).toBe('/clubs');
    expect(activeNavHref('/events/e9', TABS)).toBe('/events');
  });

  it('lights the longest matching href, not the first', () => {
    // Nothing shipped nests today, but the deeper href must still win: a nav
    // gaining a child entry would otherwise light parent and child at once.
    const NESTED = ['/manage/c1', '/manage/c1/events'];
    expect(activeNavHref('/manage/c1/events/e9', NESTED)).toBe('/manage/c1/events');
    expect(activeNavHref('/manage/c1/members', NESTED)).toBe('/manage/c1');
  });

  it('lights no tab on the profile screens, which left the tab bar', () => {
    // Catches a tab list still carrying /profile: the avatar is lit instead,
    // and a stray entry would also swallow /profile/qr.
    expect(activeNavHref('/profile', TABS)).toBeNull();
    expect(activeNavHref('/profile/registrations', TABS)).toBeNull();
    expect(activeNavHref('/profile/notifications', TABS)).toBeNull();
    expect(activeNavHref('/profile/qr', TABS)).toBe('/profile/qr');
  });

  it('lights nothing for a route that is not under any tab', () => {
    expect(activeNavHref('/admin/users', TABS)).toBeNull();
  });
});
