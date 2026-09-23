import { describe, expect, it } from 'vitest';
import { isTabRoot } from './back';

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
