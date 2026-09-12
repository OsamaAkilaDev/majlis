import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { API_PREFIX } from '../src/config/api-prefix';
import { createTestApp } from './app';
import { loginAsAdmin, loginAsStudent } from './auth-helpers';
import { createTestPrisma, disconnectTestPrisma, truncateAll } from './db';
import { makeActiveLead, makeActiveOfficer, makeClub, mkAppointment } from './factories';

const prisma = createTestPrisma();
let app: INestApplication;

beforeAll(async () => {
  app = await createTestApp();
});

afterAll(async () => {
  await app.close();
  await disconnectTestPrisma(prisma);
});

beforeEach(async () => {
  await truncateAll(prisma);
});

function join(cookie: string, clubId: string) {
  return request(app.getHttpServer())
    .post(`${API_PREFIX}/clubs/${clubId}/membership-requests`)
    .set('Cookie', cookie);
}

function decide(cookie: string, clubId: string, requestId: string, status: 'ACTIVE' | 'REJECTED') {
  return request(app.getHttpServer())
    .patch(`${API_PREFIX}/clubs/${clubId}/membership-requests/${requestId}`)
    .set('Cookie', cookie)
    .send({ status });
}

describe('POST /clubs/:clubId/membership-requests, by policy', () => {
  it('joins immediately under OPEN', async () => {
    const club = await makeClub({ membershipPolicy: 'OPEN' });
    const student = await loginAsStudent(app);
    const res = await join(student.sessionCookie, club.id);

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('ACTIVE');
  });

  it('creates a PENDING request under APPROVAL_REQUIRED', async () => {
    const club = await makeClub({ membershipPolicy: 'APPROVAL_REQUIRED' });
    const student = await loginAsStudent(app);
    const res = await join(student.sessionCookie, club.id);

    // Catches a handler that ignores the policy and always writes ACTIVE,
    // which every OPEN test would still pass.
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('PENDING');
  });

  it('refuses under INVITE_ONLY and under CLOSED', async () => {
    for (const policy of ['INVITE_ONLY', 'CLOSED'] as const) {
      const club = await makeClub({ membershipPolicy: policy });
      const student = await loginAsStudent(app);
      expect((await join(student.sessionCookie, club.id)).status).toBe(422);
      expect(await prisma.clubMembership.count({ where: { clubId: club.id } })).toBe(0);
    }
  });

  it('refuses joining a suspended or archived club whatever the policy', async () => {
    for (const status of ['SUSPENDED', 'ARCHIVED'] as const) {
      const club = await makeClub({ membershipPolicy: 'OPEN', status });
      const student = await loginAsStudent(app);
      expect((await join(student.sessionCookie, club.id)).status).toBe(422);
      expect(await prisma.clubMembership.count({ where: { clubId: club.id } })).toBe(0);
    }
  });

  it('returns 409 for a second request while one is open', async () => {
    const club = await makeClub({ membershipPolicy: 'APPROVAL_REQUIRED' });
    const student = await loginAsStudent(app);
    expect((await join(student.sessionCookie, club.id)).status).toBe(201);
    const second = await join(student.sessionCookie, club.id);
    expect(second.status).toBe(409);
    // The global Problem Details filter maps any escaping P2002 to a generic
    // 409 too, so the status code alone would pass even with mapWriteError
    // deleted. The specific detail message is what proves mapWriteError ran.
    expect(second.body.detail).toBe('You already have an open membership in that club.');
    // The 409 must not have left a second row behind.
    expect(
      await prisma.clubMembership.count({ where: { clubId: club.id, userId: student.userId } }),
    ).toBe(1);
  });

  it('lets someone who left request again', async () => {
    // LEFT is outside the partial unique index predicate, which is what
    // makes rejoining possible at all. Catches an index built on
    // (club_id, user_id) with no WHERE clause, which would lock a student
    // out of a club forever the moment they left it once.
    const club = await makeClub({ membershipPolicy: 'OPEN' });
    const student = await loginAsStudent(app);
    await join(student.sessionCookie, club.id);
    await request(app.getHttpServer())
      .delete(`${API_PREFIX}/clubs/${club.id}/membership`)
      .set('Cookie', student.sessionCookie);

    expect((await join(student.sessionCookie, club.id)).status).toBe(201);
    // Two rows must exist: the LEFT one and the new ACTIVE one. A rejoin
    // that overwrote the old row instead of creating a new one would still
    // pass a check that only looks at the newest row's status.
    const rows = await prisma.clubMembership.findMany({ where: { clubId: club.id, userId: student.userId } });
    expect(rows).toHaveLength(2);
  });

  it('admits exactly one membership when two requests race', async () => {
    // Two real concurrent requests, not two sequential calls. A sequential
    // pair passes against a check-then-insert implementation; only genuine
    // concurrency exercises the index.
    const club = await makeClub({ membershipPolicy: 'OPEN' });
    const student = await loginAsStudent(app);

    const results = await Promise.allSettled([
      join(student.sessionCookie, club.id),
      join(student.sessionCookie, club.id),
    ]);

    const responses = results.map((r) => (r.status === 'fulfilled' ? r.value : undefined));
    const codes = responses.map((r) => r?.status ?? 500).sort();
    expect(codes).toEqual([201, 409]);
    const loser = responses.find((r) => r?.status === 409);
    expect(loser?.body.detail).toBe('You already have an open membership in that club.');
    expect(
      await prisma.clubMembership.count({
        where: { clubId: club.id, userId: student.userId, status: { in: ['PENDING', 'ACTIVE'] } },
      }),
    ).toBe(1);
  });
});

describe('PATCH /clubs/:clubId/membership-requests/:requestId', () => {
  it('lets Operations approve and refuses Marketing', async () => {
    const club = await makeClub({ membershipPolicy: 'APPROVAL_REQUIRED' });
    const ops = await makeActiveOfficer(app, club.id, 'OPERATIONS');
    const marketing = await makeActiveOfficer(app, club.id, 'MARKETING');
    const applicant = await loginAsStudent(app);
    const req = await join(applicant.sessionCookie, club.id);

    expect((await decide(marketing.sessionCookie, club.id, req.body.id, 'ACTIVE')).status).toBe(403);
    // Marketing's refusal must not have decided the row behind the 403.
    expect(
      (await prisma.clubMembership.findUniqueOrThrow({ where: { id: req.body.id } })).status,
    ).toBe('PENDING');

    expect((await decide(ops.sessionCookie, club.id, req.body.id, 'ACTIVE')).status).toBe(200);
  });

  it('refuses a request that belongs to another club', async () => {
    // Deviation D5, same class of bug as the team route.
    const clubA = await makeClub({ membershipPolicy: 'APPROVAL_REQUIRED' });
    const clubB = await makeClub({ membershipPolicy: 'APPROVAL_REQUIRED' });
    const leadA = await makeActiveLead(app, clubA.id);
    const applicant = await loginAsStudent(app);
    const reqB = await join(applicant.sessionCookie, clubB.id);

    expect((await decide(leadA.sessionCookie, clubA.id, reqB.body.id, 'ACTIVE')).status).toBe(404);
    expect(
      (await prisma.clubMembership.findUniqueOrThrow({ where: { id: reqB.body.id } })).status,
    ).toBe('PENDING');
  });

  it('refuses an officer deciding their own request', async () => {
    // Main spec 6.2. Catches a handler with the permission check but not
    // the self check, which is the whole rule.
    const club = await makeClub({ membershipPolicy: 'APPROVAL_REQUIRED' });
    const ops = await makeActiveOfficer(app, club.id, 'OPERATIONS');
    await prisma.clubMembership.deleteMany({ where: { clubId: club.id, userId: ops.userId } });
    const own = await join(ops.sessionCookie, club.id);

    expect((await decide(ops.sessionCookie, club.id, own.body.id, 'ACTIVE')).status).toBe(422);
    expect(
      (await prisma.clubMembership.findUniqueOrThrow({ where: { id: own.body.id } })).status,
    ).toBe('PENDING');
  });

  it('refuses deciding a row that is not PENDING', async () => {
    const club = await makeClub({ membershipPolicy: 'APPROVAL_REQUIRED' });
    const lead = await makeActiveLead(app, club.id);
    const applicant = await loginAsStudent(app);
    const req = await join(applicant.sessionCookie, club.id);

    expect((await decide(lead.sessionCookie, club.id, req.body.id, 'ACTIVE')).status).toBe(200);
    expect((await decide(lead.sessionCookie, club.id, req.body.id, 'REJECTED')).status).toBe(422);
    // Still ACTIVE from the first decision, not flipped to REJECTED by the second.
    expect(
      (await prisma.clubMembership.findUniqueOrThrow({ where: { id: req.body.id } })).status,
    ).toBe('ACTIVE');
  });

  it('still lets a SUSPENDED club decide a request already in flight', async () => {
    const club = await makeClub({ membershipPolicy: 'APPROVAL_REQUIRED' });
    const lead = await makeActiveLead(app, club.id);
    const applicant = await loginAsStudent(app);
    const req = await join(applicant.sessionCookie, club.id);
    await prisma.club.update({ where: { id: club.id }, data: { status: 'SUSPENDED' } });

    expect((await decide(lead.sessionCookie, club.id, req.body.id, 'ACTIVE')).status).toBe(200);
  });

  it('refuses deciding in an archived club, leaving the request PENDING', async () => {
    const club = await makeClub({ membershipPolicy: 'APPROVAL_REQUIRED' });
    const lead = await makeActiveLead(app, club.id);
    const applicant = await loginAsStudent(app);
    const req = await join(applicant.sessionCookie, club.id);
    await prisma.club.update({ where: { id: club.id }, data: { status: 'ARCHIVED' } });

    expect((await decide(lead.sessionCookie, club.id, req.body.id, 'ACTIVE')).status).toBe(422);
    expect(
      (await prisma.clubMembership.findUniqueOrThrow({ where: { id: req.body.id } })).status,
    ).toBe('PENDING');
  });
});

describe('POST /clubs/:clubId/members', () => {
  it('is the way in under INVITE_ONLY', async () => {
    const club = await makeClub({ membershipPolicy: 'INVITE_ONLY' });
    const lead = await makeActiveLead(app, club.id);
    const student = await loginAsStudent(app);

    const res = await request(app.getHttpServer())
      .post(`${API_PREFIX}/clubs/${club.id}/members`)
      .set('Cookie', lead.sessionCookie)
      .send({ userId: student.userId });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('ACTIVE');
  });

  it('refuses a plain member adding someone', async () => {
    const club = await makeClub({ membershipPolicy: 'INVITE_ONLY' });
    const member = await loginAsStudent(app);
    await prisma.clubMembership.create({ data: { clubId: club.id, userId: member.userId, status: 'ACTIVE' } });
    const outsider = await loginAsStudent(app);

    expect(
      (
        await request(app.getHttpServer())
          .post(`${API_PREFIX}/clubs/${club.id}/members`)
          .set('Cookie', member.sessionCookie)
          .send({ userId: outsider.userId })
      ).status,
    ).toBe(403);
    // The 403 must not have created a membership behind it.
    expect(await prisma.clubMembership.count({ where: { clubId: club.id, userId: outsider.userId } })).toBe(0);
  });

  it('refuses under CLOSED: CLOSED is the one policy nobody joins by any route', async () => {
    // Ruling: if addMember worked under CLOSED, CLOSED and INVITE_ONLY would
    // be behaviourally identical and CLOSED would not be a distinct policy.
    const club = await makeClub({ membershipPolicy: 'CLOSED' });
    const lead = await makeActiveLead(app, club.id);
    const student = await loginAsStudent(app);

    const res = await request(app.getHttpServer())
      .post(`${API_PREFIX}/clubs/${club.id}/members`)
      .set('Cookie', lead.sessionCookie)
      .send({ userId: student.userId });

    expect(res.status).toBe(422);
    expect(await prisma.clubMembership.count({ where: { clubId: club.id, userId: student.userId } })).toBe(0);
  });
});

describe('leaving and removal', () => {
  it('sets LEFT for the caller and REMOVED for an officer removal', async () => {
    const club = await makeClub({ membershipPolicy: 'OPEN' });
    const lead = await makeActiveLead(app, club.id);
    const student = await loginAsStudent(app);
    await join(student.sessionCookie, club.id);

    expect(
      (
        await request(app.getHttpServer())
          .delete(`${API_PREFIX}/clubs/${club.id}/membership`)
          .set('Cookie', student.sessionCookie)
      ).status,
    ).toBe(204);
    expect(
      (await prisma.clubMembership.findFirstOrThrow({ where: { clubId: club.id, userId: student.userId } })).status,
    ).toBe('LEFT');

    const other = await loginAsStudent(app);
    await join(other.sessionCookie, club.id);
    expect(
      (
        await request(app.getHttpServer())
          .delete(`${API_PREFIX}/clubs/${club.id}/members/${other.userId}`)
          .set('Cookie', lead.sessionCookie)
      ).status,
    ).toBe(204);
    // The two must be distinguishable: REMOVED is a decision someone made,
    // LEFT is the member's own. Catches both routes writing LEFT.
    expect(
      (await prisma.clubMembership.findFirstOrThrow({ where: { clubId: club.id, userId: other.userId } })).status,
    ).toBe('REMOVED');
  });

  it('refuses leaving or removing in an archived club', async () => {
    const club = await makeClub({ membershipPolicy: 'OPEN' });
    const lead = await makeActiveLead(app, club.id);
    const student = await loginAsStudent(app);
    await join(student.sessionCookie, club.id);
    await prisma.club.update({ where: { id: club.id }, data: { status: 'ARCHIVED' } });

    expect(
      (
        await request(app.getHttpServer())
          .delete(`${API_PREFIX}/clubs/${club.id}/membership`)
          .set('Cookie', student.sessionCookie)
      ).status,
    ).toBe(422);
    expect(
      (
        await request(app.getHttpServer())
          .delete(`${API_PREFIX}/clubs/${club.id}/members/${student.userId}`)
          .set('Cookie', lead.sessionCookie)
      ).status,
    ).toBe(422);
    // Neither refusal moved the row off ACTIVE.
    expect(
      (await prisma.clubMembership.findFirstOrThrow({ where: { clubId: club.id, userId: student.userId } })).status,
    ).toBe('ACTIVE');
  });
});

describe('no such club', () => {
  it('refuses a membership request against a club that does not exist', async () => {
    const student = await loginAsStudent(app);
    expect((await join(student.sessionCookie, randomUUID())).status).toBe(404);
  });

  it('refuses adding a member to a club that does not exist', async () => {
    const admin = await loginAsAdmin(app);
    const target = await loginAsStudent(app);
    expect(
      (
        await request(app.getHttpServer())
          .post(`${API_PREFIX}/clubs/${randomUUID()}/members`)
          .set('Cookie', admin.sessionCookie)
          .send({ userId: target.userId })
      ).status,
    ).toBe(404);
  });

  it('refuses leaving a club that does not exist', async () => {
    const student = await loginAsStudent(app);
    expect(
      (
        await request(app.getHttpServer())
          .delete(`${API_PREFIX}/clubs/${randomUUID()}/membership`)
          .set('Cookie', student.sessionCookie)
      ).status,
    ).toBe(404);
  });

  it('refuses removing a member from a club that does not exist', async () => {
    const admin = await loginAsAdmin(app);
    const target = await loginAsStudent(app);
    expect(
      (
        await request(app.getHttpServer())
          .delete(`${API_PREFIX}/clubs/${randomUUID()}/members/${target.userId}`)
          .set('Cookie', admin.sessionCookie)
      ).status,
    ).toBe(404);
  });
});

describe('leave and remove refuse a row that is not open', () => {
  it('refuses leaving with no open membership', async () => {
    const club = await makeClub({ membershipPolicy: 'OPEN' });
    const student = await loginAsStudent(app);
    expect(
      (
        await request(app.getHttpServer())
          .delete(`${API_PREFIX}/clubs/${club.id}/membership`)
          .set('Cookie', student.sessionCookie)
      ).status,
    ).toBe(404);
  });

  it('refuses removing a user with no open membership', async () => {
    const club = await makeClub({ membershipPolicy: 'OPEN' });
    const lead = await makeActiveLead(app, club.id);
    const stranger = await loginAsStudent(app);
    expect(
      (
        await request(app.getHttpServer())
          .delete(`${API_PREFIX}/clubs/${club.id}/members/${stranger.userId}`)
          .set('Cookie', lead.sessionCookie)
      ).status,
    ).toBe(404);
  });
});

describe('GET /clubs/:clubId/members', () => {
  it('filters by status and shows club roles', async () => {
    const club = await makeClub({ membershipPolicy: 'APPROVAL_REQUIRED' });
    const otherClub = await makeClub({ membershipPolicy: 'OPEN' });
    const lead = await makeActiveLead(app, club.id);
    const pending = await loginAsStudent(app);
    await join(pending.sessionCookie, club.id);
    // A control ACTIVE row: without it, a query that ignores `status`
    // entirely would still return exactly one item and pass.
    const activeMember = await loginAsStudent(app);
    await request(app.getHttpServer())
      .post(`${API_PREFIX}/clubs/${club.id}/members`)
      .set('Cookie', lead.sessionCookie)
      .send({ userId: activeMember.userId });
    // The same user holds a role here and a different role in another club.
    // Only the first must come back, proving the batching does not leak.
    await mkAppointment({ userId: activeMember.userId, clubId: club.id, role: 'MARKETING', status: 'ACTIVE' });
    await mkAppointment({ userId: activeMember.userId, clubId: otherClub.id, role: 'CTO', status: 'ACTIVE' });

    const res = await request(app.getHttpServer())
      .get(`${API_PREFIX}/clubs/${club.id}/members?status=PENDING`)
      .set('Cookie', lead.sessionCookie);

    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].userId).toBe(pending.userId);

    const activeRes = await request(app.getHttpServer())
      .get(`${API_PREFIX}/clubs/${club.id}/members?status=ACTIVE`)
      .set('Cookie', lead.sessionCookie);

    expect(activeRes.body.items).toHaveLength(1);
    expect(activeRes.body.items[0].clubRoles).toEqual(['MARKETING']);
  });
});

describe('GET /me/clubs', () => {
  it('lists the caller memberships with their per-club roles', async () => {
    const club = await makeClub({ membershipPolicy: 'OPEN' });
    const clubWithRole = await makeClub({ membershipPolicy: 'OPEN' });
    const student = await loginAsStudent(app);
    await join(student.sessionCookie, club.id);
    await join(student.sessionCookie, clubWithRole.id);
    await mkAppointment({ userId: student.userId, clubId: clubWithRole.id, role: 'MARKETING', status: 'ACTIVE' });

    const res = await request(app.getHttpServer())
      .get(`${API_PREFIX}/me/clubs`)
      .set('Cookie', student.sessionCookie);

    expect(res.body.items).toHaveLength(2);
    const byClub = new Map<string, { clubRoles: string[] }>(
      res.body.items.map((i: { clubId: string; clubRoles: string[] }) => [i.clubId, i]),
    );
    // Proves roles attach to the right club rather than leaking across the
    // two rows the same student holds.
    expect(byClub.get(club.id)!.clubRoles).toEqual([]);
    expect(byClub.get(clubWithRole.id)!.clubRoles).toEqual(['MARKETING']);
  });

  it('lists a left-and-rejoined club exactly once, as the new ACTIVE row', async () => {
    // "lets someone who left request again" proves two rows exist for this
    // club afterward (one LEFT, one live). Unfiltered, this club would show
    // up twice: once as a dead LEFT entry with nothing sensible to do.
    const club = await makeClub({ membershipPolicy: 'OPEN' });
    const student = await loginAsStudent(app);
    await join(student.sessionCookie, club.id);
    await request(app.getHttpServer())
      .delete(`${API_PREFIX}/clubs/${club.id}/membership`)
      .set('Cookie', student.sessionCookie);
    await join(student.sessionCookie, club.id);

    const res = await request(app.getHttpServer())
      .get(`${API_PREFIX}/me/clubs`)
      .set('Cookie', student.sessionCookie);

    const rowsForClub = res.body.items.filter((i: { clubId: string }) => i.clubId === club.id);
    expect(rowsForClub).toHaveLength(1);
    expect(rowsForClub[0].status).toBe('ACTIVE');
  });
});

describe('roster visibility by club status', () => {
  it('keeps an ACTIVE club roster open to any signed-in user', async () => {
    // The gate added below must not over-restrict: an active club's list is
    // deliberately public to signed-in users.
    const club = await makeClub({ membershipPolicy: 'OPEN' });
    const outsider = await loginAsStudent(app);

    expect(
      (await request(app.getHttpServer())
        .get(`${API_PREFIX}/clubs/${club.id}/members`)
        .set('Cookie', outsider.sessionCookie)).status,
    ).toBe(200);
  });

  it('hides a suspended club roster from a non-member', async () => {
    // Member rows carry full name and email. Without this gate a student can
    // enumerate suspended clubs and read every member's email address.
    const club = await makeClub({ status: 'SUSPENDED' });
    const outsider = await loginAsStudent(app);

    expect(
      (await request(app.getHttpServer())
        .get(`${API_PREFIX}/clubs/${club.id}/members`)
        .set('Cookie', outsider.sessionCookie)).status,
    ).toBe(403);
  });

  it('still shows a suspended club roster to its own officer and to an Admin', async () => {
    const club = await makeClub({ status: 'SUSPENDED' });
    const lead = await makeActiveLead(app, club.id);
    const admin = await loginAsAdmin(app);

    for (const cookie of [lead.sessionCookie, admin.sessionCookie]) {
      expect(
        (await request(app.getHttpServer())
          .get(`${API_PREFIX}/clubs/${club.id}/members`)
          .set('Cookie', cookie)).status,
      ).toBe(200);
    }
  });

  it('applies the same gate to the team list', async () => {
    const club = await makeClub({ status: 'ARCHIVED' });
    const outsider = await loginAsStudent(app);

    expect(
      (await request(app.getHttpServer())
        .get(`${API_PREFIX}/clubs/${club.id}/team`)
        .set('Cookie', outsider.sessionCookie)).status,
    ).toBe(403);
  });
});
