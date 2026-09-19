// Every time in the product renders on the viewer's own clock, 12-hour
// (revised 2026-09-19; it was the venue's zone with the viewer's as a second
// line, spec 3). Instants are stored UTC and the zone is only ever a rendering
// choice, so there is one choice and it is the reader's.
//
// Two locales, on purpose. `en-GB` puts the day before the month, which is how
// every date in the product reads; it also writes a lowercase "pm" and names
// Dubai "GST". `en-US` writes "6:00 PM" and "GMT+4". So the date is formatted
// in one and the clock in the other, and `event-time.test.ts` fails if either
// half moves to the other.
const DATE_LOCALE = 'en-GB';
const TIME_LOCALE = 'en-US';

const DATE: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short' };
const TIME: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit', hour12: true };

function part(
  value: Date,
  timeZone: string,
  options: Intl.DateTimeFormatOptions,
  locale: string,
): string {
  return new Intl.DateTimeFormat(locale, { ...options, timeZone }).format(value);
}

const date = (value: Date, timeZone: string) => part(value, timeZone, DATE, DATE_LOCALE);
const clock = (value: Date, timeZone: string, extra: Intl.DateTimeFormatOptions = {}) =>
  part(value, timeZone, { ...TIME, ...extra }, TIME_LOCALE);

/**
 * "Sat 12 Sept, 6:00 PM to 9:00 PM", repeating the date only across midnight.
 *
 * No zone suffix. Everything on screen is already the reader's own clock, so
 * naming the zone labels every time in the product with the one fact the
 * reader cannot be wrong about.
 */
export function formatRange(startsAt: string, endsAt: string, timeZone: string): string {
  const start = new Date(startsAt);
  const end = new Date(endsAt);

  const startDate = date(start, timeZone);
  const endDate = date(end, timeZone);
  const from = clock(start, timeZone);
  const to = clock(end, timeZone);

  return startDate === endDate
    ? `${startDate}, ${from} to ${to}`
    : `${startDate}, ${from} to ${endDate}, ${to}`;
}

export function formatMoment(at: string, timeZone: string): string {
  const value = new Date(at);
  return `${date(value, timeZone)}, ${clock(value, timeZone)}`;
}

/**
 * UTC, to the day. A certificate carries no venue, and the viewer's zone
 * differs between server and browser: that is a hydration mismatch, which
 * React answers by throwing the whole tree away.
 */
export function formatDay(at: string): string {
  return new Intl.DateTimeFormat(DATE_LOCALE, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(at));
}

export function viewerTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}
