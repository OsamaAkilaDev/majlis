import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { cursorPageQuerySchema, cursorPageSchema } from './pagination';

describe('cursorPageQuerySchema', () => {
  it('defaults limit to 20 when absent', () => {
    expect(cursorPageQuerySchema.parse({}).limit).toBe(20);
  });

  it('coerces a string limit from a query string', () => {
    expect(cursorPageQuerySchema.parse({ limit: '50' }).limit).toBe(50);
  });

  it('rejects a limit above 100, so no endpoint can return an unbounded list', () => {
    expect(() => cursorPageQuerySchema.parse({ limit: 101 })).toThrow();
  });

  it('rejects a limit below 1', () => {
    expect(() => cursorPageQuerySchema.parse({ limit: 0 })).toThrow();
  });
});

describe('cursorPageSchema', () => {
  it('wraps an item schema and allows a null nextCursor on the last page', () => {
    const schema = cursorPageSchema(z.object({ id: z.string() }));
    const parsed = schema.parse({ items: [{ id: 'a' }], nextCursor: null });
    expect(parsed.items).toHaveLength(1);
    expect(parsed.nextCursor).toBeNull();
  });

  it('rejects items that do not match the item schema', () => {
    const schema = cursorPageSchema(z.object({ id: z.string() }));
    expect(() => schema.parse({ items: [{ id: 1 }], nextCursor: null })).toThrow();
  });
});
