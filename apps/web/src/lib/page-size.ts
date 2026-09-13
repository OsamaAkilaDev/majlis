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
 * How many unread notifications the tab-bar badge asks for. The API has no
 * count route, so the badge shows the page size it got back and says "9+"
 * once it fills, rather than claiming a total it never read.
 */
export const UNREAD_CAP = 10;
