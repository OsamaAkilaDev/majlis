import { describe, expect, it } from 'vitest';
import { resolveRequestId } from './request-id';

describe('resolveRequestId', () => {
  it('reuses a caller-supplied header value', () => {
    expect(resolveRequestId('trace-me-123')).toBe('trace-me-123');
  });

  it('treats a blank header as absent', () => {
    // Catches: a `typeof v === 'string'` check alone, which accepts '' as a
    // valid id — satisfying audit_log.request_id's NOT NULL constraint while
    // being useless for correlating anything.
    expect(resolveRequestId('')).not.toBe('');
  });

  it('treats a whitespace-only header as absent', () => {
    expect(resolveRequestId('   ')).not.toBe('   ');
  });

  it('generates an id when no header was sent', () => {
    expect(resolveRequestId(undefined)).toEqual(expect.any(String));
    expect(resolveRequestId(undefined).length).toBeGreaterThan(0);
  });

  it('ignores a repeated header (array value), generating a fresh id', () => {
    expect(resolveRequestId(['a', 'b'])).not.toEqual(['a', 'b']);
  });

  it('rejects a value with characters outside the allowlist', () => {
    // Catches a `typeof v === 'string' && v.trim().length > 0` check alone,
    // which stores ANY non-blank string verbatim into audit_log.request_id
    // — an append-only column with no delete path — letting an
    // unauthenticated caller stamp an arbitrary value (e.g. one copied off
    // an admin's own response header) onto a permission.denied row forever.
    expect(resolveRequestId('trace/me;123')).not.toBe('trace/me;123');
    expect(resolveRequestId('<script>alert(1)</script>')).not.toBe('<script>alert(1)</script>');
  });

  it('rejects a value over 64 characters, since the field has no length cap otherwise', () => {
    const tooLong = 'a'.repeat(65);
    expect(resolveRequestId(tooLong)).not.toBe(tooLong);
  });

  it('accepts a 64-character value at the boundary', () => {
    const atLimit = 'a'.repeat(64);
    expect(resolveRequestId(atLimit)).toBe(atLimit);
  });
});
