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
    // Catches an implementation that checks clubRoles first. Such a code path
    // passes every single-role test above, and only an admin who also happens
    // to lead a club is ever misrouted, which is the demo account.
    expect(
      landingFor(user({ platformRole: 'ADMIN', clubRoles: [{ clubId: 'c1', clubName: 'Club c1', role: 'LEAD' }] })),
    ).toBe('/admin');
  });

  it('picks the same club every time for an officer of several', () => {
    // Catches clubRoles[0], which follows whatever order the API returned and
    // can land the same person on a different console between two page loads.
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
    // Catches the defect this whole task exists for. Treating a missing session
    // cookie as "anonymous" logs out every user after 15 idle minutes even
    // though they hold a valid 30-day refresh token.
    expect(decideRedirect({ pathname: '/home', ...stale })).toBeNull();
  });

  it('never bounces a visitor off /login, however signed-in their cookies look', () => {
    // Catches ERR_TOO_MANY_REDIRECTS. A cookie the server rejects still makes
    // hasSession true here, so bouncing /login to / meant / redirected back to
    // /login forever. /login and /signup do this bounce themselves, against a
    // validated session. Restore `signedIn ? { to: '/' }` and this goes red.
    expect(decideRedirect({ pathname: '/login', ...live })).toBeNull();
    expect(decideRedirect({ pathname: '/signup', ...live })).toBeNull();
    expect(decideRedirect({ pathname: '/login', ...stale })).toBeNull();
  });

  it('leaves an anonymous visitor on /login', () => {
    expect(decideRedirect({ pathname: '/login', ...anon })).toBeNull();
  });

  it('never gates /setup, which exists to create the account that signs you in', () => {
    // ERR_TOO_MANY_REDIRECTS again, in the one state no seeded test can
    // reach. On a deployment with no admin, /login redirects to /setup; if
    // middleware sends an anonymous visitor from /setup back to /login, the
    // two bounce forever and the only screen that can create an admin is
    // unreachable for good. Drop '/setup' from AUTH_ROUTES and this goes red.
    expect(decideRedirect({ pathname: '/setup', ...anon })).toBeNull();
    // And it must not bounce a stale or live cookie either, for the same
    // reason /login does not: presence is not a session, and /setup validates
    // one itself before deciding.
    expect(decideRedirect({ pathname: '/setup', ...stale })).toBeNull();
    expect(decideRedirect({ pathname: '/setup', ...live })).toBeNull();
  });

  it('never gates the password reset routes, signed in or not', () => {
    // Somebody asking for a reset link cannot sign in by definition. Gating
    // these sends exactly the visitor who needs them to the form they are
    // locked out of, and the reset flow is then unreachable in production.
    expect(decideRedirect({ pathname: '/forgot-password', ...anon })).toBeNull();
    expect(decideRedirect({ pathname: '/reset-password', ...anon })).toBeNull();
    // A live session is no reason to bounce either: the reset requested on a
    // phone is opened on the laptop its holder is still signed in on, and
    // there is no change-password screen anywhere else to send them to.
    expect(decideRedirect({ pathname: '/reset-password', ...live })).toBeNull();
    expect(decideRedirect({ pathname: '/forgot-password', ...live })).toBeNull();
  });

  it('never gates public certificate verification', () => {
    // Catches a prefix match that gates everything not explicitly allowed.
    // /verify is opened by an employer who has no account at all.
    expect(decideRedirect({ pathname: '/verify/ABC123', ...anon })).toBeNull();
  });

  it('does not treat /loginary as the login route', () => {
    // Catches pathname.startsWith('/login'), which would send an anonymous
    // visitor of any route beginning with those characters to the wrong place.
    expect(decideRedirect({ pathname: '/loginary', ...anon })).toEqual({ to: '/login' });
  });

  it('does not treat /verifyfoo as the public verify route', () => {
    // Catches PUBLIC_PREFIXES.some((p) => pathname.startsWith(p)), which would
    // leave any route beginning with those characters ungated.
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
    // Catches an implementation that appends instead of replacing, which
    // would leave both the expired and the renewed value on the header.
    expect(result.match(/majlis_session=/g)).toHaveLength(1);
  });

  it('appends when majlis_session is absent', () => {
    const result = mergeSessionCookie('majlis_refresh=abc', [
      'majlis_session=new; Path=/; HttpOnly',
    ]);
    expect(result).toBe('majlis_refresh=abc; majlis_session=new');
  });

  it('ignores a majlis_refresh Set-Cookie entry', () => {
    // Catches an implementation that merges the first Set-Cookie entry
    // regardless of name, which would let a refresh-token rotation overwrite
    // the session cookie's slot or leak the refresh value into the header.
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
    // Catches a switcher that always renders: a student with nowhere else to
    // go would see a one-entry menu offering the shell they are already in.
    expect(shellDestinations(user())).toEqual([{ href: '/home', label: 'Home' }]);
  });

  it('gives an admin who also leads a club every shell, admin first', () => {
    // The exact user the review found stranded: an ADMIN with clubRoles had no
    // reachable path to /manage/*. An implementation returning only the
    // landingFor destination passes every single-role case and fails this one.
    expect(
      shellDestinations(user({ platformRole: 'ADMIN', clubRoles: [{ clubId: 'c1', clubName: 'Club c1', role: 'VICE_LEAD' }] })),
    ).toEqual([
      { href: '/admin', label: 'Admin' },
      { href: '/manage/c1/overview', label: 'Club c1', meta: 'Vice Lead' },
      { href: '/home', label: 'Home' },
    ]);
  });

  it('names a club destination by the club, with the role as its meta line', () => {
    // Catches the label the switcher shipped before: the role alone, which
    // gave an officer of two clubs two rows both reading "Officer". The two
    // fixtures share a role on purpose, so an implementation that still
    // labels by role produces two identical labels and goes red.
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
    // Catches a map over clubRoles as given: the menu would reshuffle between
    // requests whenever the API returns the roles in a different order.
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
    // The defect this replaces: an exact match left a club page and an event
    // page with no tab lit at all, so the viewer lost their sense of place.
    expect(activeNavHref('/clubs/robotics-club', TABS)).toBe('/clubs');
    expect(activeNavHref('/events/e9', TABS)).toBe('/events');
  });

  it('lights the longest matching href, not the first', () => {
    // No pair in the shipped navigations nests any more, but the algorithm
    // still has to prefer the deeper href: a console nav that ever gains a
    // child entry would otherwise light its parent and the child at once.
    const NESTED = ['/manage/c1', '/manage/c1/events'];
    expect(activeNavHref('/manage/c1/events/e9', NESTED)).toBe('/manage/c1/events');
    expect(activeNavHref('/manage/c1/members', NESTED)).toBe('/manage/c1');
  });

  it('lights no tab on the profile screens, which left the tab bar', () => {
    // Catches a tab list that still carries /profile: the screens reached by
    // the avatar deliberately light nothing, because the avatar is lit
    // instead. A stray '/profile' entry here would also swallow /profile/qr.
    expect(activeNavHref('/profile', TABS)).toBeNull();
    expect(activeNavHref('/profile/registrations', TABS)).toBeNull();
    expect(activeNavHref('/profile/notifications', TABS)).toBeNull();
    expect(activeNavHref('/profile/qr', TABS)).toBe('/profile/qr');
  });

  it('lights nothing for a route that is not under any tab', () => {
    expect(activeNavHref('/admin/users', TABS)).toBeNull();
  });
});
