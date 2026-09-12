/**
 * Event times render in the venue's zone with the viewer's as secondary
 * (spec 3, 13). `Event.timezone` is an IANA name, so Intl does the whole job
 * and no date library is needed.
 */

const DATE: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short' };
const TIME: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' };

function part(value: Date, timeZone: string, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat('en-GB', { ...options, timeZone }).format(value);
}

/** "Sat 14 Sep, 18:00 to 21:00 GMT+4", carrying the second date only when the event crosses midnight there. */
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

export function viewerTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/**
 * The venue's rendering, plus the viewer's when it actually differs. Compared
 * on the rendered strings rather than the zone names, so a viewer in
 * Asia/Muscat reading an Asia/Dubai event is not shown the same line twice.
 *
 * `viewerZone` has no default: a Server Component renders in the server's zone,
 * which for any viewer elsewhere is a hydration mismatch, and React answers one
 * by throwing the whole tree away. Callers pass `useViewerZone()`, which is
 * undefined until mounted, so the secondary line appears only in the browser.
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

/**
 * The value an <input type="datetime-local"> wants: a wall clock with no zone.
 * Rendered in the editor's own zone, which is what that control means, and
 * read back the same way. A venue in another zone is a single-campus
 * non-problem today; the editor shows the venue-zone rendering beside it.
 */
export function toDateTimeLocal(iso: string): string {
  const value = new Date(iso);
  return new Date(value.getTime() - value.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

export function fromDateTimeLocal(local: string): string {
  return new Date(local).toISOString();
}
