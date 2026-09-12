import { describe, expect, it } from 'vitest';
import { createDepartmentBodySchema } from './index';

describe('createDepartmentBodySchema', () => {
  it('rejects a lowercase code', () => {
    // The column is compared case-sensitively for uniqueness, so "cs" and
    // "CS" would both be storable and neither would collide.
    expect(createDepartmentBodySchema.safeParse({ name: 'Computer Science', code: 'cs' }).success).toBe(false);
  });

  it('rejects a code with punctuation', () => {
    expect(createDepartmentBodySchema.safeParse({ name: 'Computer Science', code: 'C-S' }).success).toBe(false);
  });

  it('accepts an uppercase alphanumeric code', () => {
    expect(createDepartmentBodySchema.safeParse({ name: 'Computer Science', code: 'CS01' }).success).toBe(true);
  });
});
