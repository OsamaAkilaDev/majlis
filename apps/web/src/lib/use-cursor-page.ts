'use client';

import { useCallback, useState } from 'react';

interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

/**
 * The items-and-cursor half of a cursor-paginated list. Fetching stays with
 * the caller, which is where the filters and the other reads a screen batches
 * with its first page live; this owns only what an arriving page does to the
 * state, so "replace" and "append" cannot drift apart between screens.
 *
 * `items` is null until the first page lands, which is what every caller
 * renders a skeleton on. `null` passed to `show` puts it back there.
 */
export function useCursorPage<T>(initial?: Page<T> | null) {
  const [items, setItems] = useState<T[] | null>(initial?.items ?? null);
  const [cursor, setCursor] = useState<string | null>(initial?.nextCursor ?? null);

  const show = useCallback((page: Page<T> | null) => {
    setItems(page?.items ?? null);
    setCursor(page?.nextCursor ?? null);
  }, []);

  const append = useCallback((page: Page<T>) => {
    setItems((prev) => [...(prev ?? []), ...page.items]);
    setCursor(page.nextCursor);
  }, []);

  return { items, cursor, setItems, show, append };
}
