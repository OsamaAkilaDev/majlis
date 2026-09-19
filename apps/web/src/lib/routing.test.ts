import { describe, expect, it } from 'vitest';
import type { SessionUser } from '@majlis/contracts';
import {
  activeNavHref,
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
  it('sends a plain student to /home', () => {
    expect(landingFor(user())).toBe('/home');
  });

  it('sends an admin to /admin', () => {
    expect(landingFor(user({ platformRole: 'ADMIN' }))).toBe('/admin');
  });

  it('sends an officer to their club console', () => {
    expect(landingFor(user({ clubRoles: [{ clubId: 'c1', clubName: 'Club c1', role: 'LEAD' }] }))).toBe('/manage/c1');
  });

  it('prefers /admin for a user who is BOTH admin and officer', () => {
    // Catches checking clubRoles first, which passes every single-role test
    // above and misroutes only an admin who also leads a club.
    expect(
      landingFor(user({ platformRole: 'ADMIN', clubRoles: [{ clubId: 'c1', clubName: 'Club c1', role: 'LEAD' }] })),
    ).toBe('/admin');
  });

  it('picks the same club every time for an officer of several', () => {
    // Catches clubRoles[0]: API order, so the same person lands on a different
    // console between two page loads.
    const roles = [
      { clubId: 'c9', clubName: 'Club c9', role: 'LEAD' },
      { clubId: 'c2', clubName: 'Club c2', role: 'OPERATIONS' },
      { clubId: 'c5', clubName: 'Club c5', role: 'MARKETING' },
    ];
    expect(landingFor(user({ clubRoles: roles }))).toBe('/manage/c2');
    expect(landingFor(user({ clubRoles: [...roles].reverse() }))).toBe('/manage/c2');
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
  it('gives a plain student one destination, so no switcher is shown', () => {
    // Catches a switcher that always renders: a one-entry menu offering the
    // shell you are already in.
    expect(shellDestinations(user())).toEqual([{ href: '/home', label: 'Home' }]);
  });

  it('gives an admin who also leads a club every shell, admin first', () => {
    // An ADMIN with clubRoles had no reachable path to /manage/*. Returning
    // only the landingFor destination passes every single-role case and fails
    // this one.
    expect(
      shellDestinations(user({ platformRole: 'ADMIN', clubRoles: [{ clubId: 'c1', clubName: 'Club c1', role: 'VICE_LEAD' }] })),
    ).toEqual([
      { href: '/admin', label: 'Admin' },
      { href: '/manage/c1/overview', label: 'Club c1', meta: 'Vice Lead' },
      { href: '/home', label: 'Home' },
    ]);
  });

  it('names a club destination by the club, with the role as its meta line', () => {
    // Catches labelling by role alone, which gave an officer of two clubs two
    // rows both reading "Officer". The fixtures share a role on purpose.
    const rows = shellDestinations(
      user({
        clubRoles: [
          { clubId: 'ca', clubName: 'Robotics Club', role: 'OPERATIONS' },
          { clubId: 'cb', clubName: 'Debate Society', role: 'OPERATIONS' },
        ],
      }),
    );
    expect(rows.slice(0, 2)).toEqual([
      { href: '/manage/ca/overview', label: 'Robotics Club', meta: 'Operations' },
      { href: '/manage/cb/overview', label: 'Debate Society', meta: 'Operations' },
    ]);
  });

  it('orders a multi-club officer deterministically, not by array order', () => {
    // Catches mapping clubRoles as given: the menu reshuffles whenever the API
    // returns them in a different order.
    const byIdOrder = shellDestinations(
      user({ clubRoles: [{ clubId: 'cb', clubName: 'Club cb', role: 'LEAD' }, { clubId: 'ca', clubName: 'Club ca', role: 'OPERATIONS' }] }),
    );
    expect(byIdOrder.map((d) => d.href)).toEqual([
      '/manage/ca/overview',
      '/manage/cb/overview',
      '/home',
    ]);
  });
});

describe('activeNavHref', () => {
  const TABS = ['/home', '/clubs', '/events', '/profile/qr'];

  it('lights the tab for its own route', () => {
    expect(activeNavHref('/home', TABS)).toBe('/home');
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
