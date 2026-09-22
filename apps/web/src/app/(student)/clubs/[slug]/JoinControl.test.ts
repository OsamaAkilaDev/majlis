import type { ClubDetail } from '@majlis/contracts';
import { describe, expect, it } from 'vitest';
import { decide } from './JoinControl';

function club(overrides: Partial<ClubDetail> = {}): ClubDetail {
  return {
    id: '00000000-0000-7000-8000-000000000001',
    slug: 'robotics',
    name: 'Robotics Society',
    category: 'Technology',
    logoUrl: 'https://example.test/logo.png',
    status: 'ACTIVE',
    membershipPolicy: 'OPEN',
    departmentName: 'Engineering',
    memberCount: 1,
    description: 'A club.',
    academicYear: '2026/2027',
    bannerUrl: null,
    departmentId: '00000000-0000-7000-8000-000000000002',
    viewerMembershipStatus: null,
    viewerClubRoles: [],
    committee: [],
    pendingMemberCount: null,
    eventsRun: 0,
    ...overrides,
  };
}

describe('decide', () => {
  it('states the policy in the label of the one control', () => {
    // Four policies, four labels. A matrix collapsed to "Join" plus a
    // paragraph under it would pass nothing here.
    expect(decide(club({ membershipPolicy: 'OPEN' })).label).toBe('Join club');
    expect(decide(club({ membershipPolicy: 'APPROVAL_REQUIRED' })).label).toBe('Request to join');
    expect(decide(club({ membershipPolicy: 'INVITE_ONLY' })).label).toBe('Invite only');
    expect(decide(club({ membershipPolicy: 'CLOSED' })).label).toBe('Joining closed');
  });

  it('blocks the two policies that admit nobody, and only those two', () => {
    expect(decide(club({ membershipPolicy: 'INVITE_ONLY' })).kind).toBe('blocked');
    expect(decide(club({ membershipPolicy: 'CLOSED' })).kind).toBe('blocked');
    expect(decide(club({ membershipPolicy: 'OPEN' })).kind).toBe('join');
    expect(decide(club({ membershipPolicy: 'APPROVAL_REQUIRED' })).kind).toBe('request');
  });

  it('puts the viewer relationship ahead of the policy', () => {
    // An OPEN club would otherwise offer "Join club" to somebody who is
    // already in it, or to somebody it removed.
    expect(decide(club({ viewerMembershipStatus: 'ACTIVE' })).kind).toBe('leave');
    expect(decide(club({ viewerMembershipStatus: 'PENDING' })).kind).toBe('withdraw');
    expect(decide(club({ viewerMembershipStatus: 'REMOVED' })).kind).toBe('blocked');
  });

  it('reads an officer by their membership, not by their role', () => {
    // Stage 9 deleted the "Open club console" branch this control used to take
    // first: an officer is already on the page their work happens on, and the
    // Manage button beside this one is what opens it. A role is an appointment
    // and a membership is a separate record, so the two are answered
    // separately here.
    expect(decide(club({ viewerClubRoles: ['LEAD'], viewerMembershipStatus: 'ACTIVE' })).kind).toBe(
      'leave',
    );
    expect(decide(club({ viewerClubRoles: ['LEAD'], viewerMembershipStatus: null })).kind).toBe(
      'join',
    );
  });

  it('treats LEFT and REJECTED as not a member, not as a refusal', () => {
    expect(decide(club({ viewerMembershipStatus: 'LEFT' })).kind).toBe('join');
    expect(decide(club({ viewerMembershipStatus: 'REJECTED' })).kind).toBe('join');
  });

  it('shuts joining on a club that is not active', () => {
    // Only an officer or an Admin reaches one: the API answers a student 404.
    const decision = decide(club({ status: 'SUSPENDED' }));
    expect(decision.kind).toBe('blocked');
    expect(decision.why).toContain('suspended');
  });

  it('names every blocked control for a screen reader', () => {
    // A disabled button's reason lives in its styling for a sighted reader and
    // nowhere at all without this.
    for (const c of [
      club({ membershipPolicy: 'INVITE_ONLY' }),
      club({ membershipPolicy: 'CLOSED' }),
      club({ viewerMembershipStatus: 'REMOVED' }),
      club({ status: 'ARCHIVED' }),
    ]) {
      expect(decide(c).why).toBeTruthy();
    }
  });
});
