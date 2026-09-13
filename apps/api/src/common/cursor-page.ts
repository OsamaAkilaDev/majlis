/**
 * The findMany arguments every list endpoint shares. Ordered on `id`, which
 * is uuid v7: ascending id order is also creation order, so a cursor is a
 * stable position rather than one a concurrent insert or update reshuffles.
 *
 * `direction` picks which end of that order a list starts from. It defaults
 * to `asc` because most lists read forwards, and is `desc` wherever the
 * newest row is the one the reader came for: the inbox, the audit viewer and
 * a holder's certificates. Prisma derives the cursor comparison from
 * `orderBy`, so flipping the direction flips the seek with it; hardcoding
 * `asc` here while paging a newest-first list would skip rows at every
 * page boundary.
 *
 * One row beyond `limit` is fetched so `cursorPage` can tell whether another
 * page exists without a second COUNT query. `limit`'s upper bound is enforced
 * by `cursorPageQuerySchema` at the validation boundary (see @majlis/contracts).
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

/**
 * Trims the lookahead row `cursorArgs` asked for and derives the cursor from
 * the last row actually returned, never from the lookahead one, which the
 * caller has not been shown yet.
 */
export function cursorPage<R extends { id: string }>(
  rows: R[],
  limit: number,
): { items: R[]; nextCursor: string | null } {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  return { items, nextCursor: hasMore ? items[items.length - 1]!.id : null };
}
