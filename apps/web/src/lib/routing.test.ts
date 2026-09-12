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
    expect(landingFor(user({ clubRoles: [{ clubId: 'c1', role: 'LEAD' }] }))).toBe('/manage/c1');
  });

  it('prefers /admin for a user who is BOTH admin and officer', () => {
    // Catches an implementation that checks clubRoles first. Such a code path
    // passes every single-role test above, and only an admin who also happens
    // to lead a club is ever misrouted, which is the demo account.
    expect(
      landingFor(user({ platformRole: 'ADMIN', clubRoles: [{ clubId: 'c1', role: 'LEAD' }] })),
    ).toBe('/admin');
  });

  it('picks the same club every time for an officer of several', () => {
    // Catches clubRoles[0], which follows whatever order the API returned and
    // can land the same person on a different console between two page loads.
    const roles = [
      { clubId: 'c9', role: 'LEAD' },
      { clubId: 'c2', role: 'OPERATIONS' },
      { clubId: 'c5', role: 'MARKETING' },
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

  it('sends a signed-in visitor away from /login', () => {
    expect(decideRedirect({ pathname: '/login', ...live })).toEqual({ to: '/' });
  });

  it('leaves an anonymous visitor on /login', () => {
    expect(decideRedirect({ pathname: '/login', ...anon })).toBeNull();
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
      shellDestinations(user({ platformRole: 'ADMIN', clubRoles: [{ clubId: 'c1', role: 'VICE_LEAD' }] })),
    ).toEqual([
      { href: '/admin', label: 'Admin' },
      { href: '/manage/c1/overview', label: 'Vice lead' },
      { href: '/home', label: 'Home' },
    ]);
  });

  it('orders a multi-club officer deterministically, not by array order', () => {
    // Catches a map over clubRoles as given: the menu would reshuffle between
    // requests whenever the API returns the roles in a different order.
    const byIdOrder = shellDestinations(
      user({ clubRoles: [{ clubId: 'cb', role: 'LEAD' }, { clubId: 'ca', role: 'OPERATIONS' }] }),
    );
    expect(byIdOrder.map((d) => d.href)).toEqual([
      '/manage/ca/overview',
      '/manage/cb/overview',
      '/home',
    ]);
  });
});

describe('activeNavHref', () => {
  const TABS = ['/home', '/clubs', '/events', '/me/qr', '/me'];

  it('lights the tab for its own route', () => {
    expect(activeNavHref('/home', TABS)).toBe('/home');
    expect(activeNavHref('/me', TABS)).toBe('/me');
  });

  it('lights My QR, not Me, on /me/qr', () => {
    // Catches a plain prefix match: /me is a prefix of /me/qr, so a naive
    // implementation lights two tabs at once.
    expect(activeNavHref('/me/qr', TABS)).toBe('/me/qr');
  });

  it('lights Me on its sub-routes', () => {
    // The defect this replaces: excluding /me from prefix matching to protect
    // /me/qr left these two screens with no tab lit at all.
    expect(activeNavHref('/me/registrations', TABS)).toBe('/me');
    expect(activeNavHref('/me/certificates', TABS)).toBe('/me');
  });

  it('lights nothing for a route that is not under any tab', () => {
    expect(activeNavHref('/admin/metrics', TABS)).toBeNull();
  });
});
