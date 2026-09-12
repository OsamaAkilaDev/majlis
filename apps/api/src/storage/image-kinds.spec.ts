import { describe, expect, it } from 'vitest';
import { objectPath, publicUrl } from './image-kinds';

describe('objectPath', () => {
  it('builds a path under the kind folder from the resource id', () => {
    expect(objectPath('club-logo', 'abc')).toBe('clubs/abc/logo.webp');
    expect(objectPath('club-banner', 'abc')).toBe('clubs/abc/banner.webp');
  });

  it('refuses a resource id containing a path separator', () => {
    // Catches string interpolation with no validation. A resourceId of
    // "../../site" would write outside the club's folder, and the id
    // reaches this function from a request parameter.
    expect(() => objectPath('club-logo', '../site')).toThrow(/resource id/i);
    expect(() => objectPath('club-logo', 'a/b')).toThrow(/resource id/i);
  });

  it('refuses an empty resource id', () => {
    expect(() => objectPath('club-logo', '')).toThrow(/resource id/i);
  });
});

describe('publicUrl', () => {
  it('carries a version query so a replacement is a distinct URL', () => {
    // Catches a builder that omits ?v=. Deterministic object names mean a
    // replaced logo has the same URL, and every cache keeps serving the
    // old bytes.
    const url = publicUrl('https://x.supabase.co', 'clubs/abc/logo.webp', 1700000000000);
    expect(url).toBe(
      'https://x.supabase.co/storage/v1/object/public/majlis-storage/clubs/abc/logo.webp?v=1700000000000',
    );
  });

  it('does not double a slash when the base URL has a trailing one', () => {
    expect(publicUrl('https://x.supabase.co/', 'clubs/abc/logo.webp', 1)).not.toContain('.co//');
  });
});
