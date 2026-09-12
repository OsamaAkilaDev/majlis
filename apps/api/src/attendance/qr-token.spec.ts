import { describe, expect, it } from 'vitest';
import { signPass, verifyPass } from './qr-token';

const SECRET = 'x'.repeat(32);
const OTHER_SECRET = 'y'.repeat(32);
const USER_ID = '018f8f5b-0000-7000-8000-000000000001';
const ISSUED_AT = new Date('2026-09-12T10:00:00.000Z');

function aPass(overrides: { tokenVersion?: number; userId?: string } = {}): string {
  return signPass(
    {
      userId: overrides.userId ?? USER_ID,
      tokenVersion: overrides.tokenVersion ?? 1,
      issuedAt: ISSUED_AT,
    },
    SECRET,
  );
}

describe('signPass', () => {
  it('round-trips the whole payload and nothing else', () => {
    const result = verifyPass(aPass({ tokenVersion: 7 }), SECRET);

    expect(result).toEqual({
      ok: true,
      payload: { userId: USER_ID, tokenVersion: 7, issuedAt: ISSUED_AT },
    });
  });

  it('carries no personal data on the wire', () => {
    // Spec 7.5: the payload is user id, version and issue time, full stop.
    // A token that carried an email or a name would put it on a printed
    // image and in every scanner's camera roll.
    const token = aPass();
    const payload = Buffer.from(token.split('.')[1]!, 'base64url');

    expect(payload).toHaveLength(22);
    expect(payload.subarray(0, 16).toString('hex')).toBe(USER_ID.replaceAll('-', ''));
  });

  it('produces a different token for a different version of the same pass', () => {
    // The version is what rotation increments, so it has to be inside the
    // signed bytes. A token that ignored it would survive rotation.
    expect(aPass({ tokenVersion: 1 })).not.toBe(aPass({ tokenVersion: 2 }));
  });
});

describe('verifyPass', () => {
  it('refuses a token whose signature was tampered with', () => {
    const token = aPass();
    const [version, payload, signature] = token.split('.');
    // Flip the last base64url character to something else in the alphabet.
    const tampered = `${version}.${payload}.${signature!.slice(0, -1)}${signature!.endsWith('A') ? 'B' : 'A'}`;

    expect(verifyPass(tampered, SECRET)).toEqual({ ok: false, reason: 'BAD_SIGNATURE' });
  });

  it('refuses a token whose payload was tampered with', () => {
    // Re-signing is the attack the signature exists to stop: swap the user
    // id for someone else's and keep the signature.
    const mine = aPass();
    const theirs = aPass({ userId: '018f8f5b-0000-7000-8000-0000000000ff' });
    const forged = `${mine.split('.')[0]}.${theirs.split('.')[1]}.${mine.split('.')[2]}`;

    expect(verifyPass(forged, SECRET)).toEqual({ ok: false, reason: 'BAD_SIGNATURE' });
  });

  it('refuses a token signed with a different secret', () => {
    // Catches an implementation that verifies the shape and never the HMAC:
    // anyone could then mint a pass for any user id they can guess.
    expect(verifyPass(aPass(), OTHER_SECRET)).toEqual({ ok: false, reason: 'BAD_SIGNATURE' });
  });

  it.each([
    ['an empty string', ''],
    ['a bare word', 'nonsense'],
    ['a wrong version prefix', aPass().replace('v1.', 'v2.')],
    ['too few segments', aPass().split('.').slice(0, 2).join('.')],
    ['a short payload', 'v1.AAAA.AAAAAAAAAAAAAAAAAAAAAA'],
    ['a short signature', `v1.${aPass().split('.')[1]}.AAAA`],
    ['characters outside base64url', 'v1.!!!!.????'],
  ])('answers MALFORMED for %s rather than throwing', (_name, token) => {
    // Everything here arrives from a camera pointed at an arbitrary printed
    // image. A throw would be a 500 on the scanner screen instead of the
    // "invalid pass" the operator can act on.
    expect(() => verifyPass(token, SECRET)).not.toThrow();
    expect(verifyPass(token, SECRET).ok).toBe(false);
  });
});
