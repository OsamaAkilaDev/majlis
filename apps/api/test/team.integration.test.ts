import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { API_PREFIX } from '../src/config/api-prefix';
import { createTestApp } from './app';
import { loginAsAdmin, loginAsStudent } from './auth-helpers';
import { createTestPrisma, disconnectTestPrisma, truncateAll } from './db';
import { makeActiveLead, makeActiveOfficer, makeClub } from './factories';

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

    // The whole point of INVITED. Catches an appointment created ACTIVE,
    // which hands full Lead authority to someone who never accepted.
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
  // Needs POST /appointments/:id/accept, which Task 7 adds. Re-enable by
  // switching `it.todo` back to `it` and uncommenting the body below. Do
  // not stub an accept route early just to make this pass.
  it.todo('admits two INVITED Leads but only the first acceptance');

  /*
  it('admits two INVITED Leads but only the first acceptance', async () => {
    // The partial unique index covers ACTIVE rows only, so a club can hold
    // several INVITED candidates at once and the constraint fires at
    // acceptance. Correct, and surprising enough to pin down. Two distinct
    // users, because a single user would collide on other grounds and the
    // test would pass against a broken index.
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

    expect(
      (
        await request(app.getHttpServer())
          .post(`${API_PREFIX}/appointments/${b.body.id}/accept`)
          .set('Cookie', second.sessionCookie)
      ).status,
    ).toBe(409);

    const active = await prisma.clubTeamAppointment.findMany({
      where: { clubId: club.id, role: 'LEAD', status: 'ACTIVE' },
    });
    expect(active).toHaveLength(1);
    expect(active[0]!.userId).toBe(first.userId);
  });
  */
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
    // Spec 6.1 gives "invite / end team appointments" to Lead only.
    expect((await invite(vice.sessionCookie)).status).toBe(403);

    // Catches a guard scoped to the wrong param, or missing entirely, which
    // would let the Vice Lead's denied call still slip a second row in.
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
  it('lists appointments with user info and computes hasLeftClub from the membership row', async () => {
    const club = await makeClub();
    const lead = await makeActiveLead(app, club.id);
    await prisma.clubMembership.create({ data: { clubId: club.id, userId: lead.userId, status: 'ACTIVE' } });
    // No ordinary membership row for this one: an appointment with no
    // matching ACTIVE membership must report hasLeftClub true.
    const officer = await makeActiveOfficer(app, club.id, 'OPERATIONS');

    const res = await request(app.getHttpServer())
      .get(`${API_PREFIX}/clubs/${club.id}/team`)
      .set('Cookie', lead.sessionCookie);

    expect(res.status).toBe(200);
    const byUser = new Map<string, { hasLeftClub: boolean; userEmail: string }>(
      res.body.items.map((a: { userId: string; hasLeftClub: boolean; userEmail: string }) => [a.userId, a]),
    );
    expect(byUser.get(lead.userId)?.hasLeftClub).toBe(false);
    expect(byUser.get(officer.userId)?.hasLeftClub).toBe(true);
    expect(byUser.get(officer.userId)?.userEmail).toBeTruthy();
  });
});

describe('DELETE /clubs/:clubId/team/:appointmentId', () => {
  it('refuses an appointment that belongs to another club', async () => {
    // Deviation D5. The guard resolves scope from params.clubId, so a Lead
    // of club A passing club A's id with club B's appointment id would end
    // another club's officer unless the handler checks ownership.
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
});
