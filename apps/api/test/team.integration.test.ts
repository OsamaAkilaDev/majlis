import type { INestApplication } from '@nestjs/common';
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

describe('POST /clubs/:clubId/lead', () => {
  it('creates an INVITED appointment that grants nothing yet', async () => {
    const admin = await loginAsAdmin(app);
    const club = await makeClub();
    const nominee = await loginAsStudent(app);

    const res = await request(app.getHttpServer())
      .post(`${API_PREFIX}/clubs/${club.id}/lead`)
      .set('Cookie', admin.sessionCookie)
      .send({ userId: nominee.userId });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('INVITED');

    // Catches an appointment created ACTIVE, handing full Lead authority to
    // someone who never accepted.
    expect(
      (
        await request(app.getHttpServer())
          .patch(`${API_PREFIX}/clubs/${club.id}`)
          .set('Cookie', nominee.sessionCookie)
          .send({ category: 'Engineering' })
      ).status,
    ).toBe(403);
  });

  it('refuses a Lead appointing their own successor', async () => {
    const club = await makeClub();
    const lead = await makeActiveLead(app, club.id);
    const nominee = await loginAsStudent(app);

    expect(
      (
        await request(app.getHttpServer())
          .post(`${API_PREFIX}/clubs/${club.id}/lead`)
          .set('Cookie', lead.sessionCookie)
          .send({ userId: nominee.userId })
      ).status,
    ).toBe(403);
  });
});

describe('the one ACTIVE Lead index', () => {
  it('admits two INVITED Leads but only the first acceptance', async () => {
    // The partial unique index covers ACTIVE rows only, so several INVITED
    // candidates coexist and the constraint fires at acceptance. Two distinct
    // users: a single user collides on other grounds and passes a broken index.
    const admin = await loginAsAdmin(app);
    const club = await makeClub();
    const first = await loginAsStudent(app);
    const second = await loginAsStudent(app);

    const inviteLead = (userId: string) =>
      request(app.getHttpServer())
        .post(`${API_PREFIX}/clubs/${club.id}/lead`)
        .set('Cookie', admin.sessionCookie)
        .send({ userId });

    const a = await inviteLead(first.userId);
    const b = await inviteLead(second.userId);
    expect([a.status, b.status]).toEqual([201, 201]);

    expect(
      (
        await request(app.getHttpServer())
          .post(`${API_PREFIX}/appointments/${a.body.id}/accept`)
          .set('Cookie', first.sessionCookie)
      ).status,
    ).toBe(201);

    const secondAccept = await request(app.getHttpServer())
      .post(`${API_PREFIX}/appointments/${b.body.id}/accept`)
      .set('Cookie', second.sessionCookie);
    expect(secondAccept.status).toBe(409);
    // The Problem Details filter maps an escaping P2002 to a generic 409 too, so
    // status alone passes with mapWriteError not matching this index. The detail
    // is what proves the mapping fired.
    expect(secondAccept.body.detail).toBe('That club already has an active Lead.');

    const active = await prisma.clubTeamAppointment.findMany({
      where: { clubId: club.id, role: 'LEAD', status: 'ACTIVE' },
    });
    expect(active).toHaveLength(1);
    expect(active[0]!.userId).toBe(first.userId);
  });
});

describe('POST /clubs/:clubId/team', () => {
  it('lets a Lead invite an officer and refuses a Vice Lead', async () => {
    const club = await makeClub();
    const lead = await makeActiveLead(app, club.id);
    const vice = await makeActiveOfficer(app, club.id, 'VICE_LEAD');
    const nominee = await loginAsStudent(app);

    const invite = (cookie: string) =>
      request(app.getHttpServer())
        .post(`${API_PREFIX}/clubs/${club.id}/team`)
        .set('Cookie', cookie)
        .send({ userId: nominee.userId, role: 'MARKETING' });

    expect((await invite(lead.sessionCookie)).status).toBe(201);
    // Inviting and ending team appointments is Lead only.
    expect((await invite(vice.sessionCookie)).status).toBe(403);

    // Catches a guard scoped to the wrong param, or missing, which lets the Vice
    // Lead's denied call slip a second row in.
    const rows = await prisma.clubTeamAppointment.findMany({
      where: { clubId: club.id, userId: nominee.userId, role: 'MARKETING' },
    });
    expect(rows).toHaveLength(1);
  });

  it('refuses a Lead inviting themselves', async () => {
    const club = await makeClub();
    const lead = await makeActiveLead(app, club.id);

    expect(
      (
        await request(app.getHttpServer())
          .post(`${API_PREFIX}/clubs/${club.id}/team`)
          .set('Cookie', lead.sessionCookie)
          .send({ userId: lead.userId, role: 'CTO' })
      ).status,
    ).toBe(422);

    const rows = await prisma.clubTeamAppointment.findMany({
      where: { clubId: club.id, userId: lead.userId, role: 'CTO' },
    });
    expect(rows).toHaveLength(0);
  });

  it('refuses inviting a user who already holds an ACTIVE appointment in that role', async () => {
    const club = await makeClub();
    const lead = await makeActiveLead(app, club.id);
    const officer = await makeActiveOfficer(app, club.id, 'MARKETING');

    const res = await request(app.getHttpServer())
      .post(`${API_PREFIX}/clubs/${club.id}/team`)
      .set('Cookie', lead.sessionCookie)
      .send({ userId: officer.userId, role: 'MARKETING' });

    expect(res.status).toBe(409);

    const rows = await prisma.clubTeamAppointment.findMany({
      where: { clubId: club.id, userId: officer.userId, role: 'MARKETING' },
    });
    expect(rows).toHaveLength(1);
  });
});

describe('GET /clubs/:clubId/team', () => {
  it('computes hasLeftClub from the ClubMembership row, not the appointment role', async () => {
    const club = await makeClub();
    // A Lead reads it: the list is open to anyone signed in, but only
    // club:team-manage sees the addresses, asserted below.
    const viewer = await makeActiveLead(app, club.id);
    const stillMember = await makeActiveOfficer(app, club.id, 'MARKETING');
    await prisma.clubMembership.create({ data: { clubId: club.id, userId: stillMember.userId, status: 'ACTIVE' } });
    // Same role as stillMember, no membership row: varying only membership
    // presence catches hasLeftClub derived from the appointment's role, or
    // anything else correlated with it, rather than a ClubMembership lookup.
    const left = await makeActiveOfficer(app, club.id, 'MARKETING');

    const res = await request(app.getHttpServer())
      .get(`${API_PREFIX}/clubs/${club.id}/team`)
      .set('Cookie', viewer.sessionCookie);

    expect(res.status).toBe(200);
    const byUser = new Map<string, { hasLeftClub: boolean; userEmail: string }>(
      res.body.items.map((a: { userId: string; hasLeftClub: boolean; userEmail: string }) => [a.userId, a]),
    );
    expect(byUser.get(stillMember.userId)?.hasLeftClub).toBe(false);
    expect(byUser.get(left.userId)?.hasLeftClub).toBe(true);
    expect(byUser.get(left.userId)?.userEmail).toBeTruthy();
  });
});

describe('DELETE /clubs/:clubId/team/:appointmentId', () => {
  it('refuses an appointment that belongs to another club', async () => {
    // The guard resolves scope from params.clubId, so a Lead of club A passing
    // club B's appointment id ends another club's officer unless the handler
    // checks ownership.
    const clubA = await makeClub();
    const clubB = await makeClub();
    const leadA = await makeActiveLead(app, clubA.id);
    const officerB = await makeActiveOfficer(app, clubB.id, 'OPERATIONS');

    const res = await request(app.getHttpServer())
      .delete(`${API_PREFIX}/clubs/${clubA.id}/team/${officerB.appointmentId}`)
      .set('Cookie', leadA.sessionCookie)
      .send({ reason: 'Cross club attempt.' });

    expect(res.status).toBe(404);
    const after = await prisma.clubTeamAppointment.findUniqueOrThrow({
      where: { id: officerB.appointmentId },
    });
    expect(after.status).toBe('ACTIVE');
  });

  it('ends an appointment without deleting the row or the membership', async () => {
    const club = await makeClub();
    const lead = await makeActiveLead(app, club.id);
    const officer = await makeActiveOfficer(app, club.id, 'MARKETING');
    await prisma.clubMembership.create({
      data: { clubId: club.id, userId: officer.userId, status: 'ACTIVE' },
    });

    expect(
      (
        await request(app.getHttpServer())
          .delete(`${API_PREFIX}/clubs/${club.id}/team/${officer.appointmentId}`)
          .set('Cookie', lead.sessionCookie)
          .send({ reason: 'Term over.' })
      ).status,
    ).toBe(204);

    const row = await prisma.clubTeamAppointment.findUniqueOrThrow({ where: { id: officer.appointmentId } });
    expect(row.status).toBe('ENDED');
    expect(row.endedReason).toBe('Term over.');

    // Losing a role is not the same as leaving the club.
    const membership = await prisma.clubMembership.findFirstOrThrow({
      where: { clubId: club.id, userId: officer.userId },
    });
    expect(membership.status).toBe('ACTIVE');
  });

  it('refuses a Lead ending their own appointment', async () => {
    const club = await makeClub();
    const lead = await makeActiveLead(app, club.id);

    expect(
      (
        await request(app.getHttpServer())
          .delete(`${API_PREFIX}/clubs/${club.id}/team/${lead.appointmentId}`)
          .set('Cookie', lead.sessionCookie)
          .send({ reason: 'Resigning.' })
      ).status,
    ).toBe(422);

    const row = await prisma.clubTeamAppointment.findUniqueOrThrow({ where: { id: lead.appointmentId } });
    expect(row.status).toBe('ACTIVE');
  });

  it('refuses ending an appointment that is still INVITED, leaving it unchanged', async () => {
    const club = await makeClub();
    const lead = await makeActiveLead(app, club.id);
    const nominee = await loginAsStudent(app);
    const invited = await mkAppointment({
      userId: nominee.userId,
      clubId: club.id,
      role: 'MARKETING',
      status: 'INVITED',
    });

    const res = await request(app.getHttpServer())
      .delete(`${API_PREFIX}/clubs/${club.id}/team/${invited.id}`)
      .set('Cookie', lead.sessionCookie)
      .send({ reason: 'Rescinding.' });

    expect(res.status).toBe(422);
    const after = await prisma.clubTeamAppointment.findUniqueOrThrow({ where: { id: invited.id } });
    expect(after.status).toBe('INVITED');
  });

  it('refuses ending an appointment that is already ENDED, leaving the first ending intact', async () => {
    const club = await makeClub();
    const lead = await makeActiveLead(app, club.id);
    const officer = await makeActiveOfficer(app, club.id, 'MARKETING');

    const first = await request(app.getHttpServer())
      .delete(`${API_PREFIX}/clubs/${club.id}/team/${officer.appointmentId}`)
      .set('Cookie', lead.sessionCookie)
      .send({ reason: 'Term over.' });
    expect(first.status).toBe(204);

    const afterFirst = await prisma.clubTeamAppointment.findUniqueOrThrow({ where: { id: officer.appointmentId } });

    const second = await request(app.getHttpServer())
      .delete(`${API_PREFIX}/clubs/${club.id}/team/${officer.appointmentId}`)
      .set('Cookie', lead.sessionCookie)
      .send({ reason: 'Overwriting the record.' });
    expect(second.status).toBe(422);

    // Without the guard a second end overwrites who ended it and why, which is
    // audit history rewritten, not a wasted call.
    const afterSecond = await prisma.clubTeamAppointment.findUniqueOrThrow({ where: { id: officer.appointmentId } });
    expect(afterSecond.endedAt).toEqual(afterFirst.endedAt);
    expect(afterSecond.endedReason).toBe(afterFirst.endedReason);
    expect(afterSecond.endedReason).toBe('Term over.');
  });
});

describe('admin override on a team invitation', () => {
  it('refuses a club-roleless admin with no reason and records one when given', async () => {
    // An admin invite is an override. Catches one recording reason null, which
    // ending an appointment already avoided.
    const club = await makeClub();
    const admin = await loginAsAdmin(app);
    const nominee = await loginAsStudent(app);

    const invite = (body: object) =>
      request(app.getHttpServer())
        .post(`${API_PREFIX}/clubs/${club.id}/team`)
        .set('Cookie', admin.sessionCookie)
        .send(body);

    const bare = await invite({ userId: nominee.userId, role: 'MARKETING' });
    expect(bare.status).toBe(422);
    expect(bare.body.detail).toBe('An admin override requires a reason.');
    expect(await prisma.clubTeamAppointment.count({ where: { clubId: club.id } })).toBe(0);

    const withReason = await invite({
      userId: nominee.userId,
      role: 'MARKETING',
      overrideReason: 'The club has no Lead to do it.',
    });
    expect(withReason.status).toBe(201);

    const row = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'club.officer_invited', entityId: withReason.body.id },
    });
    expect(row.reason).toBe('The club has no Lead to do it.');
  });
});

describe('GET /clubs/:clubId/team, email visibility', () => {
  // The route carries no @RequirePermission and the list is open to any
  // signed-in user, so the address is gated in the projection. Two readers in
  // one test: the Lead alone passes against a handler that always sends the
  // address, the bystander alone against one that never does.
  it('sends userEmail to a Lead and omits it entirely for a member with no role', async () => {
    const club = await makeClub();
    const officer = await makeActiveOfficer(app, club.id, 'OPERATIONS');
    const lead = await makeActiveLead(app, club.id);
    const bystander = await loginAsStudent(app);
    await prisma.clubMembership.create({
      data: { clubId: club.id, userId: bystander.userId, status: 'ACTIVE' },
    });

    const read = (cookie: string) =>
      request(app.getHttpServer()).get(`${API_PREFIX}/clubs/${club.id}/team`).set('Cookie', cookie);

    const asLead = await read(lead.sessionCookie);
    const asBystander = await read(bystander.sessionCookie);

    expect(asLead.status).toBe(200);
    expect(asBystander.status).toBe(200);

    const rowFor = (res: request.Response) =>
      res.body.items.find((a: { userId: string }) => a.userId === officer.userId);

    expect(rowFor(asLead).userEmail).toBeTruthy();
    // The list itself stays open: the bystander still sees the officer.
    expect(rowFor(asBystander).userFullName).toBeTruthy();
    // Omitted, not nulled.
    expect(rowFor(asBystander)).not.toHaveProperty('userEmail');
  });
});
