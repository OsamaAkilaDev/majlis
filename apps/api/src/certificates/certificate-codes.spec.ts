import { describe, expect, it } from 'vitest';
import { CROCKFORD, serialNumber, verificationCode } from './certificate-codes';

describe('the Crockford alphabet', () => {
  it('excludes I, L, O and U, which is the entire reason for using it', () => {
    // Catches a stock RFC 4648 base32, which includes all four and makes a
    // code read aloud or copied off paper ambiguous between 1 and I, 0 and
    // O, and lets the alphabet spell things nobody wants printed.
    expect(CROCKFORD).toHaveLength(32);
    for (const excluded of ['I', 'L', 'O', 'U']) {
      expect(CROCKFORD).not.toContain(excluded);
    }
  });
});

describe('serialNumber', () => {
  it('is MJL, the year it was issued, and eight characters', () => {
    expect(serialNumber(new Date('2026-09-12T00:00:00Z'))).toMatch(/^MJL-2026-[0-9A-HJKMNP-TV-Z]{8}$/);
  });

  it('does not repeat itself', () => {
    // Catches a serial derived from the date alone, which every certificate
    // issued in the same run would share, against a unique index.
    const seen = new Set(Array.from({ length: 500 }, () => serialNumber()));
    expect(seen.size).toBe(500);
  });
});

describe('verificationCode', () => {
  it('carries at least 128 bits, in groups that can be read aloud', () => {
    const code = verificationCode();
    const groups = code.split('-');

    expect(groups).toHaveLength(6);
    for (const group of groups) expect(group).toMatch(/^[0-9A-HJKMNP-TV-Z]{5}$/);
    // 30 characters at five bits each. Spec 5.1 puts the floor at 128; a
    // code short enough to enumerate would make the public /verify route an
    // oracle for every certificate in the product.
    expect(groups.join('').length * 5).toBeGreaterThanOrEqual(128);
  });

  it('spreads over the whole alphabet rather than a corner of it', () => {
    // Catches a generator seeded from something weak or truncated to hex:
    // 500 codes is 15,000 characters, so every one of the 32 symbols should
    // appear many times over.
    const chars = new Set(Array.from({ length: 500 }, () => verificationCode()).join('').replaceAll('-', ''));
    expect(chars.size).toBe(32);
  });
});
