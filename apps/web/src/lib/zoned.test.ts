import { describe, expect, it } from 'vitest';
import { placeholderIn } from './zoned';

/** The venue zone in every fixture below; UTC+4, so a UTC instant of 20:00 on
 *  the 23rd is midnight on the 24th here. */
const DUBAI = 'Asia/Dubai';

describe('placeholderIn', () => {
  it('carries the zone, so the picker yields an absolute instant rather than a wall clock', () => {
    // The whole defect. React Aria decides the type of every value the picker
    // produces from the placeholder, and infers no zone from a null value: with
    // none supplied it builds a CalendarDateTime, which has no
    // `toAbsoluteString`, and the first range an officer picks throws
    // `next.start.toAbsoluteString is not a function`.
    const value = placeholderIn(DUBAI);

    expect(value.timeZone).toBe(DUBAI);
    expect(typeof value.toAbsoluteString()).toBe('string');
  });

  it('starts at midnight in the venue zone, not in the editor own zone', () => {
    // A placeholder built from the local zone shows the officer a date that is
    // right for them and wrong for the event, which is the bug `Event.timezone`
    // exists to prevent.
    const value = placeholderIn(DUBAI);

    expect([value.hour, value.minute]).toEqual([0, 0]);
    expect(new Date(value.toAbsoluteString()).toISOString()).toBe(
      new Date(
        Date.UTC(value.year, value.month - 1, value.day) - 4 * 60 * 60 * 1000,
      ).toISOString(),
    );
  });

  it('refuses nothing for an unknown zone, because the caller only offers real ones', () => {
    // `timezone` is chosen from Intl.supportedValuesOf, and an event row cannot
    // hold a zone the server could not resolve. Still, a throw here would take
    // the whole form down rather than one control, so it falls back.
    expect(placeholderIn('Not/AZone').timeZone).toBe('UTC');
  });
});
