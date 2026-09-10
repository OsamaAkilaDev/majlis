import { z } from 'zod';

export const MAX_PAGE_LIMIT = 100;
export const DEFAULT_PAGE_LIMIT = 20;

/**
 * Query parameters for every list endpoint. The upper bound on `limit` is the
 * mechanism that makes an unbounded list impossible to request.
 */
export const cursorPageQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_LIMIT).default(DEFAULT_PAGE_LIMIT),
});

export type CursorPageQuery = z.infer<typeof cursorPageQuerySchema>;

/** Wraps an item schema into a cursor-paginated page. */
export function cursorPageSchema<T extends z.ZodTypeAny>(item: T) {
  return z.object({
    items: z.array(item),
    nextCursor: z.string().nullable(),
  });
}
