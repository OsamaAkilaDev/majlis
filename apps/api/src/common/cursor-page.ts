/**
 * The findMany arguments every list endpoint shares. Ordered on `id`, which
 * is uuid v7: ascending id order is also creation order, so a cursor is a
 * stable position rather than one a concurrent insert or update reshuffles.
 *
 * One row beyond `limit` is fetched so `cursorPage` can tell whether another
 * page exists without a second COUNT query. `limit`'s upper bound is enforced
 * by `cursorPageQuerySchema` at the validation boundary (see @majlis/contracts).
 */
export function cursorArgs(query: { limit: number; cursor?: string | undefined }) {
  return {
    take: query.limit + 1,
    ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    orderBy: { id: 'asc' as const },
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
