import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { API_PREFIX } from '../src/config/api-prefix';
import { createTestApp } from './app';
import { loginAsAdmin, loginAsStudent } from './auth-helpers';
import { createTestPrisma, disconnectTestPrisma, truncateAll } from './db';
import { makeActiveLead, makeActiveOfficer, makeClub, mkEvent, mkRegistration, mkUser } from './factories';

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

function get(path: string, cookie: string) {
  return request(app.getHttpServer()).get(`${API_PREFIX}${path}`).set('Cookie', cookie);
}

const DENIED = 'You do not have permission to do that.';

describe('report:read', () => {
  it('lets an Admin read the platform overview', async () => {
    const admin = await loginAsAdmin(app);
    const club = await makeClub();
    const lead = await makeActiveLead(app, club.id);
    await mkEvent(club.id, lead.userId);

    const res = await get('/reports/overview', admin.sessionCookie).expect(200);
    expect(res.body.clubsByStatus.ACTIVE).toBe(1);
    expect(res.body.eventsByStatus.PUBLISHED).toBe(1);
  });

  it('refuses a club Lead the platform overview, which carries no scope to hold', async () => {
    const club = await makeClub();
    const lead = await makeActiveLead(app, club.id);

    const res = await get('/reports/overview', lead.sessionCookie).expect(403);
    expect(res.body.detail).toBe(DENIED);
  });

  it('lets a club Lead read their own club report', async () => {
    const club = await makeClub();
    const lead = await makeActiveLead(app, club.id);
    const event = await mkEvent(club.id, lead.userId);
    const a = await mkUser();
    const b = await mkUser();
    await mkRegistration(event.id, a.id, 'ATTENDED');
    await mkRegistration(event.id, b.id, 'NO_SHOW');

    const res = await get(`/clubs/${club.id}/reports`, lead.sessionCookie).expect(200);
    expect(res.body.events).toBe(1);
    expect(res.body.expected).toBe(2);
    expect(res.body.attended).toBe(1);
    expect(res.body.attendanceRate).toBe(0.5);
  });

  it('refuses a club Marketing officer the club report', async () => {
    const club = await makeClub();
    const marketing = await makeActiveOfficer(app, club.id, 'MARKETING');

    const res = await get(`/clubs/${club.id}/reports`, marketing.sessionCookie).expect(403);
    expect(res.body.detail).toBe(DENIED);
  });
});

describe('audit:read', () => {
  it('lets an Admin read the platform audit log', async () => {
    const admin = await loginAsAdmin(app);
    const club = await makeClub();
    await prisma.auditLog.create({
      data: {
        action: 'club.created',
        entityType: 'Club',
        entityId: club.id,
        outcome: 'SUCCESS',
        requestId: 'r1',
      },
    });

    const res = await get('/audit', admin.sessionCookie).expect(200);
    expect(res.body.items.map((i: { action: string }) => i.action)).toContain('club.created');
  });

  it('refuses a club Vice Lead, who is absent from spec 6.1 read audit log row', async () => {
    const club = await makeClub();
    const vice = await makeActiveOfficer(app, club.id, 'VICE_LEAD');

    const res = await get(`/clubs/${club.id}/audit`, vice.sessionCookie).expect(403);
    expect(res.body.detail).toBe(DENIED);
  });

  it('scopes a club Lead to their own club and refuses another club entirely', async () => {
    const mine = await makeClub();
    const theirs = await makeClub();
    const lead = await makeActiveLead(app, mine.id);
    const theirLead = await makeActiveLead(app, theirs.id);
    const theirEvent = await mkEvent(theirs.id, theirLead.userId);

    await prisma.auditLog.createMany({
      data: [
        { action: 'club.edited', entityType: 'Club', entityId: mine.id, outcome: 'SUCCESS', requestId: 'r1' },
        { action: 'club.edited', entityType: 'Club', entityId: theirs.id, outcome: 'SUCCESS', requestId: 'r2' },
        { action: 'event.published', entityType: 'Event', entityId: theirEvent.id, outcome: 'SUCCESS', requestId: 'r3' },
      ],
    });

    const refused = await get(`/clubs/${theirs.id}/audit`, lead.sessionCookie).expect(403);
    expect(refused.body.detail).toBe(DENIED);

    const own = await get(`/clubs/${mine.id}/audit`, lead.sessionCookie).expect(200);
    expect(own.body.items).toHaveLength(1);
    expect(own.body.items[0].entityId).toBe(mine.id);
  });

  it('includes a club own events, which is the whole of the club scope', async () => {
    const club = await makeClub();
    const lead = await makeActiveLead(app, club.id);
    const event = await mkEvent(club.id, lead.userId);
    await prisma.auditLog.create({
      data: {
        action: 'event.published',
        entityType: 'Event',
        entityId: event.id,
        outcome: 'SUCCESS',
        requestId: 'r1',
      },
    });

    const res = await get(`/clubs/${club.id}/audit`, lead.sessionCookie).expect(200);
    expect(res.body.items.map((i: { entityId: string }) => i.entityId)).toEqual([event.id]);
  });
});

describe('CSV exports', () => {
  it('answers events.csv as a downloadable CSV for an Admin', async () => {
    const admin = await loginAsAdmin(app);
    const club = await makeClub();
    const lead = await makeActiveLead(app, club.id);
    await mkEvent(club.id, lead.userId, { title: 'Drone Build Night' });

    const res = await get('/exports/events.csv', admin.sessionCookie).expect(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toBe('attachment; filename="events.csv"');
    expect(res.text.split('\r\n')[0]).toContain('title');
    expect(res.text).toContain('Drone Build Night');
  });

  it('carries registrations.csv behind registration:read, not report:read', async () => {
    // Attendee personal data. A club Marketing officer holds neither, and
    // that exclusion is spec 6.1's least-privilege requirement rather than
    // an oversight, so it has to hold for the file as well as the screen.
    const club = await makeClub();
    const lead = await makeActiveLead(app, club.id);
    const marketing = await makeActiveOfficer(app, club.id, 'MARKETING');
    const event = await mkEvent(club.id, lead.userId);
    const student = await mkUser();
    await mkRegistration(event.id, student.id, 'CONFIRMED');

    const refused = await get(
      `/exports/registrations.csv?eventId=${event.id}`,
      marketing.sessionCookie,
    ).expect(403);
    expect(refused.body.detail).toBe(DENIED);

    const allowed = await get(
      `/exports/registrations.csv?eventId=${event.id}`,
      lead.sessionCookie,
    ).expect(200);
    expect(allowed.text).toContain(student.email);
  });

  it('refuses an ordinary student every export', async () => {
    const student = await loginAsStudent(app);
    const club = await makeClub();
    const lead = await makeActiveLead(app, club.id);
    const event = await mkEvent(club.id, lead.userId);

    await get('/exports/events.csv', student.sessionCookie).expect(403);
    await get(`/exports/attendance.csv?eventId=${event.id}`, student.sessionCookie).expect(403);
    await get(`/exports/certificates.csv?eventId=${event.id}`, student.sessionCookie).expect(403);
  });

  it('escapes a title that would otherwise execute in a spreadsheet', async () => {
    const admin = await loginAsAdmin(app);
    const club = await makeClub();
    const lead = await makeActiveLead(app, club.id);
    await mkEvent(club.id, lead.userId, { title: '=SUM(A1,A2)' });

    const res = await get('/exports/events.csv', admin.sessionCookie).expect(200);
    expect(res.text).toContain('"\'=SUM(A1,A2)"');
    expect(res.text).not.toContain(',=SUM');
  });
});
