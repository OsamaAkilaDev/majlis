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

    // Catches a handler ignoring the policy and always writing ACTIVE, which
    // every OPEN test above still passes.
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
    // The Problem Details filter maps an escaping P2002 to a generic 409 too, so
    // status alone passes with mapWriteError deleted. The detail proves it ran.
    expect(second.body.detail).toBe('You already have an open membership in that club.');
    // The 409 must not have left a second row behind.
    expect(
      await prisma.clubMembership.count({ where: { clubId: club.id, userId: student.userId } }),
    ).toBe(1);
  });

  it('lets someone who left request again', async () => {
    // LEFT sits outside the partial unique index predicate. Catches an index on
    // (club_id, user_id) with no WHERE, which locks a student out forever.
    const club = await makeClub({ membershipPolicy: 'OPEN' });
    const student = await loginAsStudent(app);
    await join(student.sessionCookie, club.id);
    await request(app.getHttpServer())
      .delete(`${API_PREFIX}/clubs/${club.id}/membership`)
      .set('Cookie', student.sessionCookie);

    expect((await join(student.sessionCookie, club.id)).status).toBe(201);
    // Two rows, the LEFT one and the new ACTIVE one: a rejoin that overwrote the
    // old row passes a check looking only at the newest row's status.
    const rows = await prisma.clubMembership.findMany({ where: { clubId: club.id, userId: student.userId } });
    expect(rows).toHaveLength(2);
  });

  it('admits exactly one membership when two requests race', async () => {
    // Genuinely concurrent: a sequential pair passes against check-then-insert,
    // and only a real race exercises the index.
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
    // The 403 must not have decided the row behind it.
    expect(
      (await prisma.clubMembership.findUniqueOrThrow({ where: { id: req.body.id } })).status,
    ).toBe('PENDING');

    expect((await decide(ops.sessionCookie, club.id, req.body.id, 'ACTIVE')).status).toBe(200);
  });

  it('refuses a request that belongs to another club', async () => {
    // Catches a lookup by row id alone, the same bug class as the team route.
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
    // Catches a handler with the permission check but no self check.
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
    // Still ACTIVE from the first decision, not flipped by the second.
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
    // If addMember worked under CLOSED it would be identical to INVITE_ONLY and
    // not a distinct policy at all.
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
    // Catches both routes writing LEFT: REMOVED is a decision someone else made.
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
    // A control ACTIVE row: without it, a query ignoring `status` returns
    // exactly one item and passes.
    const activeMember = await loginAsStudent(app);
    await request(app.getHttpServer())
      .post(`${API_PREFIX}/clubs/${club.id}/members`)
      .set('Cookie', lead.sessionCookie)
      .send({ userId: activeMember.userId });
    // The same user holds a different role in another club: only the first may
    // come back, which proves the role batching does not leak across clubs.
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

  // The route carries no @RequirePermission and the roster is open to any
  // signed-in user, so the address is gated in the projection. Two readers in
  // one test: the Lead alone passes against a handler that always sends the
  // address, the member alone against one that never does.
  it('sends userEmail to a Lead and omits it entirely for a member with no role', async () => {
    const club = await makeClub({ membershipPolicy: 'OPEN' });
    const lead = await makeActiveLead(app, club.id);
    const subject = await loginAsStudent(app);
    await join(subject.sessionCookie, club.id);
    const reader = await loginAsStudent(app);
    await join(reader.sessionCookie, club.id);

    const read = (cookie: string) =>
      request(app.getHttpServer()).get(`${API_PREFIX}/clubs/${club.id}/members`).set('Cookie', cookie);

    const asLead = await read(lead.sessionCookie);
    const asMember = await read(reader.sessionCookie);

    expect(asLead.status).toBe(200);
    expect(asMember.status).toBe(200);

    const rowFor = (res: request.Response) =>
      res.body.items.find((m: { userId: string }) => m.userId === subject.userId);

    expect(rowFor(asLead).userEmail).toBeTruthy();
    // The list itself stays open: the other member still sees the roster.
    expect(rowFor(asMember).userFullName).toBeTruthy();
    // Omitted, not nulled.
    expect(rowFor(asMember)).not.toHaveProperty('userEmail');
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
    // Roles must attach to the right club, not leak across the student's rows.
    expect(byClub.get(club.id)!.clubRoles).toEqual([]);
    expect(byClub.get(clubWithRole.id)!.clubRoles).toEqual(['MARKETING']);
  });

  it('lists a left-and-rejoined club exactly once, as the new ACTIVE row', async () => {
    // A left-and-rejoined club holds two rows, one LEFT and one live. Catches an
    // unfiltered query, which lists the club twice, once as a dead entry.
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
    // The gate below must not over-restrict: an active club's list is open to
    // any signed-in user.
    const club = await makeClub({ membershipPolicy: 'OPEN' });
    const outsider = await loginAsStudent(app);

    expect(
      (await request(app.getHttpServer())
        .get(`${API_PREFIX}/clubs/${club.id}/members`)
        .set('Cookie', outsider.sessionCookie)).status,
    ).toBe(200);
  });

  it('hides a suspended club roster from a non-member', async () => {
    // Member rows carry full name and email, so without this gate a student can
    // enumerate suspended clubs and read every member's address.
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

describe('admin override on adding and removing a member', () => {
  it('refuses a club-roleless admin with no reason and records one when given', async () => {
    // Both writes are admin overrides. Catches either recording reason null.
    const club = await makeClub({ membershipPolicy: 'INVITE_ONLY' });
    const admin = await loginAsAdmin(app);
    const student = await loginAsStudent(app);

    const add = (body: object) =>
      request(app.getHttpServer())
        .post(`${API_PREFIX}/clubs/${club.id}/members`)
        .set('Cookie', admin.sessionCookie)
        .send(body);

    const bareAdd = await add({ userId: student.userId });
    expect(bareAdd.status).toBe(422);
    expect(bareAdd.body.detail).toBe('An admin override requires a reason.');
    expect(await prisma.clubMembership.count({ where: { clubId: club.id } })).toBe(0);

    const added = await add({ userId: student.userId, overrideReason: 'Transferred from another club.' });
    expect(added.status).toBe(201);
    expect(
      (
        await prisma.auditLog.findFirstOrThrow({
          where: { action: 'club.member_added', entityId: added.body.id },
        })
      ).reason,
    ).toBe('Transferred from another club.');

    const remove = (body: object) =>
      request(app.getHttpServer())
        .delete(`${API_PREFIX}/clubs/${club.id}/members/${student.userId}`)
        .set('Cookie', admin.sessionCookie)
        .send(body);

    const bareRemove = await remove({});
    expect(bareRemove.status).toBe(422);
    expect(bareRemove.body.detail).toBe('An admin override requires a reason.');
    expect(
      (await prisma.clubMembership.findFirstOrThrow({ where: { clubId: club.id, userId: student.userId } }))
        .status,
    ).toBe('ACTIVE');

    const removed = await remove({ overrideReason: 'Enrolment ended.' });
    expect(removed.status).toBe(204);
    expect(
      (
        await prisma.auditLog.findFirstOrThrow({
          where: { action: 'club.membership_removed', entityId: added.body.id },
        })
      ).reason,
    ).toBe('Enrolment ended.');
  });
});
