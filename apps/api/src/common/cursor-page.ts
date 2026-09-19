/**
 * Ordered on `id`, which is uuid v7, so ascending id order is creation order
 * and a cursor is a position a concurrent insert cannot reshuffle.
 *
 * Prisma derives the cursor comparison from `orderBy`, so `direction` must
 * flip both together: hardcoding `asc` while paging a newest-first list skips
 * rows at every page boundary.
 *
 * One row beyond `limit` is fetched so `cursorPage` can tell whether another
 * page exists without a second COUNT.
 */
export function cursorArgs(
  query: { limit: number; cursor?: string | undefined },
  direction: 'asc' | 'desc' = 'asc',
) {
  return {
    take: query.limit + 1,
    ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    orderBy: { id: direction },
  };
}

/** Derives the cursor from the last row RETURNED, never the lookahead one,
 *  which the caller has not been shown. */
export function cursorPage<R extends { id: string }>(
  rows: R[],
  limit: number,
): { items: R[]; nextCursor: string | null } {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  return { items, nextCursor: hasMore ? items[items.length - 1]!.id : null };
}
