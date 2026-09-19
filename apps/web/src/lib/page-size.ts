// No 'use client' here on purpose: a constant imported from a client module
// reaches a Server Component as a client reference object, not its value, and
// `limit=${PAGE}` became `limit=[object Object]` with the API answering 400.
export const PAGE = 20;

export const CONSOLE_PAGE = 50;

/** The API has no count route, so the badge shows the page size it got back
 *  and says "9+" once it fills rather than claiming a total it never read. */
export const UNREAD_CAP = 10;

/** A count off one capped page: a full page means "at least this many".
 *  `cap` is the page size it came from, so a PAGE-sized list caps at 19+. */
export function cappedCount(n: number, cap: number): string {
  return n >= cap ? `${cap - 1}+` : String(n);
}
