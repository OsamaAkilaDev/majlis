import type { SessionUser } from '@majlis/contracts';
import { describe, expect, it } from 'vitest';
import { backFallback, isTabRoot } from './back';

function user(platformRole: SessionUser['platformRole']): SessionUser {
  return {
    id: 'u1',
    email: 'a@b.com',
    fullName: 'A',
    avatarUrl: null,
    platformRole,
    clubRoles: [],
  };
}

describe('isTabRoot', () => {
  it('names the three roots the dock can reach', () => {
    // Back from a tab root leaves the app, so these are the screens that must
    // not render the control.
    expect(isTabRoot('/events')).toBe(true);
    expect(isTabRoot('/clubs')).toBe(true);
    expect(isTabRoot('/profile/qr')).toBe(true);
  });

  it('names the five sections the admin sidebar can reach', () => {
    // Same reasoning as the dock: back from a sidebar section has nowhere of
    // its own to go, and /admin/users is also the console's landing screen.
    expect(isTabRoot('/admin/users')).toBe(true);
    expect(isTabRoot('/admin/departments')).toBe(true);
    expect(isTabRoot('/admin/clubs')).toBe(true);
    expect(isTabRoot('/admin/events')).toBe(true);
    expect(isTabRoot('/admin/audit')).toBe(true);
  });

  it('does not mistake a child for its root', () => {
    // The discriminating case. A startsWith test passes every assertion above
    // and then silently drops the back button from every detail screen in the
    // app, which is the whole feature.
    expect(isTabRoot('/events/discover')).toBe(false);
    expect(isTabRoot('/events/abc-123')).toBe(false);
    expect(isTabRoot('/clubs/discover')).toBe(false);
    expect(isTabRoot('/clubs/robotics-club')).toBe(false);
    expect(isTabRoot('/profile')).toBe(false);
    expect(isTabRoot('/profile/registrations')).toBe(false);
    expect(isTabRoot('/admin/clubs/new')).toBe(false);
  });

  it('ignores a trailing slash', () => {
    // Next does not produce one, but a pathname arriving with it must not turn
    // a tab root into a screen with a back button that exits the app.
    expect(isTabRoot('/clubs/')).toBe(true);
  });
});

describe('backFallback', () => {
  it('returns to the tab a deep link opened under', () => {
    // The reported case: a notification opens straight to an event or a
    // club, with nothing behind it. A broken implementation that always
    // falls back to landingFor would pass a test that only checked the
    // default, and send an event deep link to /events/discover's neighbour
    // tab instead of back to its own.
    expect(backFallback('/events/abc-123', user('STUDENT'))).toBe('/events');
    expect(backFallback('/clubs/robotics-club', user('STUDENT'))).toBe('/clubs');
  });

  it('falls back to the viewer\'s landing outside any tab', () => {
    expect(backFallback('/profile/notifications', user('STUDENT'))).toBe('/events');
  });

  it('returns to the admin section a deep link opened under', () => {
    expect(backFallback('/admin/clubs/new', user('ADMIN'))).toBe('/admin/clubs');
  });

  it('does not loop the console landing page back to itself', () => {
    // The reported bug: with only STUDENT_TAB_ROUTES in the fallback set,
    // /admin/users matched no root and this returned /admin, which redirects
    // straight back to /admin/users, so a visible back control pressed to
    // nowhere.
    expect(backFallback('/admin/users', user('ADMIN'))).toBe('/admin/users');
  });
});
