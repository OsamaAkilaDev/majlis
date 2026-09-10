import { describe, expect, it } from 'vitest';
import { API_PREFIX } from './api-prefix';

describe('API_PREFIX', () => {
  it('keeps the leading slash the 404 and error paths depend on', () => {
    expect(API_PREFIX.startsWith('/')).toBe(true);
  });

  it('is the versioned prefix every route is served under', () => {
    expect(API_PREFIX).toBe('/api/v1');
  });
});
