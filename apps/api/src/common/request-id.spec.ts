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
});
