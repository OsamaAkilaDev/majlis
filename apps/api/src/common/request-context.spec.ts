import { describe, expect, it } from 'vitest';
import { RequestContext } from './request-context';

describe('RequestContext', () => {
  it('keeps concurrent contexts separate', async () => {
    // Catches: a context implemented with a module-level mutable variable,
    // which leaks one request's id into another's audit rows under any
    // concurrency at all. The setTimeout is the point: without
    // AsyncLocalStorage the first callback resumes after the second has
    // overwritten the shared variable, and both push 'req-2'.
    const ctx = new RequestContext();
    const seen: (string | undefined)[] = [];

    const one = ctx.run({ requestId: 'req-1' }, async () => {
      await new Promise((r) => setTimeout(r, 20));
      seen.push(ctx.current?.requestId);
    });
    const two = ctx.run({ requestId: 'req-2' }, async () => {
      seen.push(ctx.current?.requestId);
    });

    await Promise.all([one, two]);
    expect(seen.sort()).toEqual(['req-1', 'req-2']);
  });

  it('returns undefined outside any request', () => {
    expect(new RequestContext().current).toBeUndefined();
  });
});
