/**
 * List page sizes, in a plain module because both sides need the number: the
 * Server Component that renders the first page, and the client that paginates
 * on from it. A constant imported from a 'use client' module reaches a Server
 * Component as a client reference object, not its value, so `limit=${PAGE}`
 * silently became `limit=[object Object]` and the API answered 400.
 */
export const PAGE = 20;

/** A console table lists a club's whole season at once, with no Load more. */
export const CONSOLE_PAGE = 50;
