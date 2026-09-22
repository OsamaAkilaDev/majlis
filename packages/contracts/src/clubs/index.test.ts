import { describe, expect, it } from 'vitest';
import { IMAGE_KINDS, academicYearSchema, clubDetailSchema, createClubBodySchema, patchClubStatusBodySchema } from './index';

describe('academicYearSchema', () => {
  it('rejects a year pair that is not consecutive', () => {
    // Catches /^\d{4}\/\d{4}$/ alone, which accepts 2026/2030 and 2026/2020.
    expect(academicYearSchema.safeParse('2026/2030').success).toBe(false);
    expect(academicYearSchema.safeParse('2026/2025').success).toBe(false);
  });

  it('accepts a consecutive pair', () => {
    expect(academicYearSchema.safeParse('2026/2027').success).toBe(true);
  });

  it('rejects a shape that is not four digits, slash, four digits', () => {
    expect(academicYearSchema.safeParse('26/27').success).toBe(false);
    expect(academicYearSchema.safeParse('2026-2027').success).toBe(false);
  });
});

describe('patchClubStatusBodySchema', () => {
  it('rejects a body with no reason', () => {
    // Every admin override carries a recorded reason (main spec 6.1).
    expect(patchClubStatusBodySchema.safeParse({ status: 'SUSPENDED' }).success).toBe(false);
  });

  it('rejects a whitespace-only reason', () => {
    expect(
      patchClubStatusBodySchema.safeParse({ status: 'SUSPENDED', reason: '   ' }).success,
    ).toBe(false);
  });

  it('rejects a status outside the three real values', () => {
    expect(
      patchClubStatusBodySchema.safeParse({ status: 'DELETED', reason: 'x' }).success,
    ).toBe(false);
  });
});

describe('createClubBodySchema', () => {
  // No logoUrl field to test a scheme against: the client never sends one,
  // see the comment on createClubBodySchema. httpsUrlSchema itself (still
  // used elsewhere, e.g. signedUploadSchema.publicUrl) keeps its own coverage.

  it('rejects a clubId that is not a UUID', () => {
    // The server minted this id and the client echoes it back. A
    // non-UUID reaches Prisma and raises P2007 rather than a clean 400.
    const body = {
      clubId: 'not-a-uuid',
      departmentId: '01936c7e-0000-7000-8000-000000000001',
      name: 'Robotics',
      description: 'We build robots.',
      category: 'Technology',
      academicYear: '2026/2027',
      membershipPolicy: 'OPEN',
    };
    expect(createClubBodySchema.safeParse(body).success).toBe(false);
  });
});

describe('clubDetailSchema', () => {
  it('accepts a null pending count and refuses an absent one', () => {
    // On the field, not a whole fixture: `.nullable()` and `.nullish()` differ
    // only here, and the wrong one lets the API omit the key while every client
    // reads `undefined` and renders no badge for a club with twelve requests.
    const field = clubDetailSchema.shape.pendingMemberCount;
    expect(field.safeParse(null).success).toBe(true);
    expect(field.safeParse(3).success).toBe(true);
    expect(field.safeParse(undefined).success).toBe(false);
  });
});

describe('IMAGE_KINDS', () => {
  it('caps every kind under the 2MB Supabase bucket limit', () => {
    // Catches a maxBytes raised above the bucket's own reject threshold,
    // which would make the cap configuration that never actually fires.
    for (const kind of Object.values(IMAGE_KINDS)) {
      expect(kind.maxBytes).toBeLessThan(2 * 1024 * 1024);
    }
  });
});
