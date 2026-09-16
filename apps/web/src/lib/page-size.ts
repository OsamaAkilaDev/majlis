/**
 * List page sizes, in a plain module because both sides need the number: the
 * Server Component that renders the first page, and the client that paginates
 * on from it. A constant imported from a 'use client' module reaches a Server
 * Component as a client reference object, not its value, so `limit=${PAGE}`
 * silently became `limit=[object Object]` and the API answered 400.
 */
export const PAGE = 20;

/** A console table shows more rows per page than the student lists do. */
export const CONSOLE_PAGE = 50;

/**
 * How many unread notifications the header badge asks for. The API has no
 * count route, so the badge shows the page size it got back and says "9+"
 * once it fills, rather than claiming a total it never read.
 */
export const UNREAD_CAP = 10;

/**
 * A count read off one capped page, rendered honestly: a full page means "at
 * least this many" and says so. Lives here rather than beside the badge
 * because the profile screen's tiles are Server Components and this module,
 * unlike the badge's, carries no 'use client'.
 *
 * `cap` is the page size the count came from, so a tile counting a PAGE-sized
 * list caps at 19+ while the UNREAD_CAP badge caps at 9+.
 */
export function cappedCount(n: number, cap: number): string {
  return n >= cap ? `${cap - 1}+` : String(n);
}
