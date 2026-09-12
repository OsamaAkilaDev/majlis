import { describe, expect, it } from 'vitest';
import { revokeCertificateBodySchema, verificationSchema } from './index';

describe('verificationSchema', () => {
  it('discloses those six fields and nothing else, ever', () => {
    // Spec 7.6: /verify returns holder name, event title, club name, issue
    // date and status, "and nothing else, ever". This is an anonymous,
    // unauthenticated route, so a service that widened the response — an
    // email, a user id, the serial number — would publish it to the world.
    const parsed = verificationSchema.parse({
      status: 'ACTIVE',
      holderName: 'A Student',
      eventTitle: 'Robot Night',
      clubName: 'Robotics Club',
      issuedAt: '2026-09-12T10:00:00.000Z',
      revokedAt: null,
      email: 'student@uni.ac.ae',
      userId: '018f8f5b-0000-7000-8000-000000000001',
      serialNumber: 'MJL-2026-ABCDEFGH',
    });

    expect(Object.keys(parsed).sort()).toEqual([
      'clubName',
      'eventTitle',
      'holderName',
      'issuedAt',
      'revokedAt',
      'status',
    ]);
  });

  it('keeps a revoked certificate verifiable rather than absent', () => {
    const parsed = verificationSchema.parse({
      status: 'REVOKED',
      holderName: 'A Student',
      eventTitle: 'Robot Night',
      clubName: 'Robotics Club',
      issuedAt: '2026-09-12T10:00:00.000Z',
      revokedAt: '2026-09-13T10:00:00.000Z',
    });

    expect(parsed.status).toBe('REVOKED');
    expect(parsed.revokedAt).toBe('2026-09-13T10:00:00.000Z');
  });
});

describe('revokeCertificateBodySchema', () => {
  it('refuses a revocation with no reason', () => {
    expect(revokeCertificateBodySchema.safeParse({}).success).toBe(false);
    expect(revokeCertificateBodySchema.safeParse({ reason: '  ' }).success).toBe(false);
  });
});
