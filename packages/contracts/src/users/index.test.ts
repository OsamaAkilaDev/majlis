import { describe, expect, it } from 'vitest';
import { patchMeBodySchema, patchUserStatusBodySchema, userStatusSchema } from './index';

describe('userStatusSchema', () => {
  it('rejects a status outside ACTIVE/SUSPENDED', () => {
    // Catches a schema that fell back to a bare z.string() — an admin client
    // (or a bug) sending "BANNED" or "DELETED" must not be accepted as a
    // valid transition target.
    expect(userStatusSchema.safeParse('BANNED').success).toBe(false);
  });

  it('accepts both real statuses', () => {
    expect(userStatusSchema.safeParse('ACTIVE').success).toBe(true);
    expect(userStatusSchema.safeParse('SUSPENDED').success).toBe(true);
  });
});

describe('patchUserStatusBodySchema', () => {
  it('rejects a body with no reason at all', () => {
    // Catches `reason: z.string().trim().min(1).max(500).optional()` — the
    // spec requires every admin override in §11's audited-action list to
    // carry a reason, and this is the first one Stage 2 implements. Making
    // it optional leaves every existing integration test green, since they
    // all happen to send one anyway.
    expect(patchUserStatusBodySchema.safeParse({ status: 'SUSPENDED' }).success).toBe(false);
  });

  it('rejects a blank (whitespace-only) reason', () => {
    expect(
      patchUserStatusBodySchema.safeParse({ status: 'SUSPENDED', reason: '   ' }).success,
    ).toBe(false);
  });

  it('rejects an unknown status even with a valid reason', () => {
    expect(
      patchUserStatusBodySchema.safeParse({ status: 'DELETED', reason: 'cleanup' }).success,
    ).toBe(false);
  });

  it('accepts a real status with a non-blank reason', () => {
    const parsed = patchUserStatusBodySchema.parse({ status: 'SUSPENDED', reason: 'Policy violation.' });
    expect(parsed).toEqual({ status: 'SUSPENDED', reason: 'Policy violation.' });
  });
});

describe('patchMeBodySchema — avatarUrl', () => {
  it('rejects a javascript: URI', () => {
    // Catches `z.string().trim().url()` — Zod 4's .url() validates shape
    // only, not scheme, and happily accepts this. Stored verbatim, it would
    // be echoed back into the browser of everyone who ever loads this
    // profile: GET /me, every auth response, and an admin's own screen after
    // PATCH /users/{id}/status.
    expect(patchMeBodySchema.safeParse({ avatarUrl: 'javascript:alert(1)' }).success).toBe(false);
  });

  it('rejects a data: URI', () => {
    expect(patchMeBodySchema.safeParse({ avatarUrl: 'data:text/html,x' }).success).toBe(false);
  });

  it('rejects a file: URI', () => {
    expect(patchMeBodySchema.safeParse({ avatarUrl: 'file:///etc/passwd' }).success).toBe(false);
  });

  it('accepts an https URL', () => {
    expect(patchMeBodySchema.safeParse({ avatarUrl: 'https://example.test/me.png' }).success).toBe(true);
  });

  it('rejects an http URL, and anything past the length bound', () => {
    // http: was accepted until Stage 8. An avatar served over plain
    // transport into an authenticated page is mixed content, which most
    // browsers block outright, so it is a broken image rather than a
    // working one.
    expect(patchMeBodySchema.safeParse({ avatarUrl: 'http://example.test/me.png' }).success).toBe(false);
    const long = `https://example.test/${'a'.repeat(2048)}.png`;
    expect(patchMeBodySchema.safeParse({ avatarUrl: long }).success).toBe(false);
  });

  it('accepts null explicitly, distinct from omitting the field', () => {
    // Catches a schema that dropped `.nullable()` while adding the scheme
    // check — PATCH /me's contract is that null explicitly clears the
    // avatar, which is a different intent from the key being absent.
    const parsed = patchMeBodySchema.parse({ avatarUrl: null });
    expect(parsed.avatarUrl).toBeNull();
  });

  it('leaves avatarUrl undefined when the key is omitted entirely', () => {
    const parsed = patchMeBodySchema.parse({});
    expect(parsed.avatarUrl).toBeUndefined();
  });
});
