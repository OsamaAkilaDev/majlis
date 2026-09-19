// Event times render in the venue's zone with the viewer's as secondary
// (spec 3, 13). `Event.timezone` is an IANA name, so Intl does the whole job.

const DATE: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short' };
const TIME: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' };

function part(value: Date, timeZone: string, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat('en-GB', { ...options, timeZone }).format(value);
}

/** "Sat 14 Sep, 18:00 to 21:00 GMT+4", repeating the date only across midnight. */
export function formatRange(startsAt: string, endsAt: string, timeZone: string): string {
  const start = new Date(startsAt);
  const end = new Date(endsAt);

  const startDate = part(start, timeZone, DATE);
  const endDate = part(end, timeZone, DATE);
  const from = part(start, timeZone, TIME);
  const to = part(end, timeZone, { ...TIME, timeZoneName: 'short' });

  return startDate === endDate
    ? `${startDate}, ${from} to ${to}`
    : `${startDate}, ${from} to ${endDate}, ${to}`;
}

export function formatMoment(at: string, timeZone: string): string {
  const value = new Date(at);
  return `${part(value, timeZone, DATE)}, ${part(value, timeZone, { ...TIME, timeZoneName: 'short' })}`;
}

/**
 * UTC, to the day. A certificate carries no venue, and the viewer's zone
 * differs between server and browser: that is a hydration mismatch, which
 * React answers by throwing the whole tree away.
 */
export function formatDay(at: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(at));
}

export function viewerTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/**
 * The venue's rendering, plus the viewer's only where the STRING differs, so a
 * viewer in Asia/Muscat reading an Asia/Dubai event is not shown the same line
 * twice.
 *
 * `viewerZone` deliberately has no default: on the server it would be the
 * server's zone, and the hydration mismatch above. Callers pass
 * `useViewerZone()`, undefined until mounted.
 */
export function eventTimes(
  startsAt: string,
  endsAt: string,
  timeZone: string,
  viewerZone?: string,
): { venue: string; viewer: string | null } {
  const venue = formatRange(startsAt, endsAt, timeZone);
  if (!viewerZone) return { venue, viewer: null };
  const viewer = formatRange(startsAt, endsAt, viewerZone);
  return { venue, viewer: viewer === venue ? null : viewer };
}

/** The wall clock an <input type="datetime-local"> wants, in the editor's own
 *  zone, which is what that control means. Read back by fromDateTimeLocal. */
export function toDateTimeLocal(iso: string): string {
  const value = new Date(iso);
  return new Date(value.getTime() - value.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

export function fromDateTimeLocal(local: string): string {
  return new Date(local).toISOString();
}
