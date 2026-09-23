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
    expect(backFallback('/admin/clubs', user('ADMIN'))).toBe('/admin');
  });
});
