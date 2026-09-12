import { describe, expect, it } from 'vitest';
import { decideMembershipBodySchema } from './index';

describe('decideMembershipBodySchema', () => {
  it('rejects PENDING as a decision target', () => {
    // Catches `status: membershipStatusSchema`, which lets a decision
    // handler write PENDING, LEFT or REMOVED through the decide route and
    // bypass the transitions those values are supposed to go through.
    expect(decideMembershipBodySchema.safeParse({ status: 'PENDING' }).success).toBe(false);
  });

  it('rejects LEFT and REMOVED as decision targets', () => {
    expect(decideMembershipBodySchema.safeParse({ status: 'LEFT' }).success).toBe(false);
    expect(decideMembershipBodySchema.safeParse({ status: 'REMOVED' }).success).toBe(false);
  });

  it('accepts ACTIVE and REJECTED', () => {
    expect(decideMembershipBodySchema.safeParse({ status: 'ACTIVE' }).success).toBe(true);
    expect(decideMembershipBodySchema.safeParse({ status: 'REJECTED' }).success).toBe(true);
  });
});
