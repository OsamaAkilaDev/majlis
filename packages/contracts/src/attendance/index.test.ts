import { describe, expect, it } from 'vitest';
import { checkInResultSchema, correctAttendanceBodySchema, manualCheckInBodySchema, scanBodySchema } from './index';

describe('checkInResultSchema', () => {
  it('strips personal data from a failure result', () => {
    // Spec 7.5: a failure never names a student. The union is the last line
    // of that guarantee — a service that accidentally spread the looked-up
    // user onto a NOT_REGISTERED answer would disclose an unrelated person
    // to whoever is holding the scanner.
    const parsed = checkInResultSchema.parse({
      result: 'NOT_REGISTERED',
      fullName: 'Unrelated Student',
      email: 'unrelated@uni.ac.ae',
    });

    expect(parsed).toEqual({ result: 'NOT_REGISTERED' });
  });

  it('requires the original time on ALREADY_CHECKED_IN', () => {
    // The operator has to be able to tell a second scan of the same person
    // from a first one, and the time is the only thing that says which.
    expect(
      checkInResultSchema.safeParse({
        result: 'ALREADY_CHECKED_IN',
        fullName: 'A Student',
        email: 'a@uni.ac.ae',
      }).success,
    ).toBe(false);
  });
});

describe('scanBodySchema', () => {
  it('refuses an empty token rather than letting it reach the verifier', () => {
    expect(scanBodySchema.safeParse({ token: '   ' }).success).toBe(false);
  });
});

describe('manualCheckInBodySchema', () => {
  it('normalises the email the operator typed and requires a reason', () => {
    // Addresses are stored lowercased under a CHECK constraint, so a lookup
    // on the raw typed value finds nobody and reads as "not registered".
    expect(manualCheckInBodySchema.parse({ email: ' Ops@Uni.AC.ae ', reason: 'Phone died' }).email).toBe(
      'ops@uni.ac.ae',
    );
    expect(manualCheckInBodySchema.safeParse({ email: 'a@uni.ac.ae' }).success).toBe(false);
  });
});

describe('correctAttendanceBodySchema', () => {
  it('takes the state being asserted, not a toggle', () => {
    expect(correctAttendanceBodySchema.parse({ present: false, reason: 'Left early' }).present).toBe(false);
    expect(correctAttendanceBodySchema.safeParse({ reason: 'Left early' }).success).toBe(false);
  });
});
