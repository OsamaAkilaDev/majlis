import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { API_PREFIX } from '../src/config/api-prefix';
import { EXAMPLE_LIFECYCLE_SWEEP_SECRET } from '../src/config/env.schema';
import { SWEEP_SECRET_HEADER } from '../src/events/lifecycle-sweep.controller';
import { createTestApp } from './app';
import { loginAsAdmin, loginAsStudent } from './auth-helpers';
import { createTestPrisma, disconnectTestPrisma, truncateAll } from './db';
import { makeActiveLead, makeActiveOfficer, makeClub, mkEvent } from './factories';

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

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const at = (ms: number) => new Date(Date.now() + ms).toISOString();

function patch(cookie: string, eventId: string, body: object) {
  return request(app.getHttpServer())
    .patch(`${API_PREFIX}/events/${eventId}`)
    .set('Cookie', cookie)
    .send(body);
}

function publish(cookie: string, eventId: string) {
  return request(app.getHttpServer())
    .post(`${API_PREFIX}/events/${eventId}/publish`)
    .set('Cookie', cookie);
}

function detail(cookie: string, eventId: string) {
  return request(app.getHttpServer()).get(`${API_PREFIX}/events/${eventId}`).set('Cookie', cookie);
}

/** A window whose registration close is already in the past. */
const CLOSED_WINDOW = {
  registrationOpensAt: new Date(Date.now() - 2 * DAY),
  registrationClosesAt: new Date(Date.now() - HOUR),
  startsAt: new Date(Date.now() + DAY),
  endsAt: new Date(Date.now() + DAY + 2 * HOUR),
  checkInOpensAt: new Date(Date.now() + DAY - HOUR),
  checkInClosesAt: new Date(Date.now() + DAY + 3 * HOUR),
};

describe('POST /clubs/:clubId/events', () => {
  it('defaults the check-in window around the event when the body omits it', async () => {
    // Spec 5.1 and 7.3: ONGOING is defined as "now within the check-in
    // window", so an event created without one would never become ONGOING
    // and could never be scanned.
    const club = await makeClub();
    const lead = await makeActiveLead(app, club.id);

    const res = await request(app.getHttpServer())
      .post(`${API_PREFIX}/clubs/${club.id}/events`)
      .set('Cookie', lead.sessionCookie)
      .send({
        eventId: crypto.randomUUID(),
        title: 'Robot Night',
        summary: 'Robots.',
        description: 'A night of robots.',
        eventType: 'Workshop',
        audience: 'All students',
        startsAt: at(7 * DAY),
        endsAt: at(7 * DAY + 2 * HOUR),
        registrationOpensAt: at(-DAY),
        registrationClosesAt: at(6 * DAY),
        capacity: 20,
      });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('DRAFT');
    expect(res.body.slug).toBe('robot-night');
    expect(Date.parse(res.body.checkInOpensAt)).toBe(Date.parse(res.body.startsAt) - HOUR);
    expect(Date.parse(res.body.checkInClosesAt)).toBe(Date.parse(res.body.endsAt) + 30 * 60 * 1000);
  });
});

describe('PATCH /events/:eventId, field-level permissions', () => {
  it('lets a club Marketing officer edit the title and refuses them the start time', async () => {
    // Two guarantees at once. The event-scoped permission has to resolve the
    // actor's role in the event's CLUB, which no EventAssignment carries, so
    // a guard that only looked at EventAssignment would 403 the allowed half.
    // And the field gate is the only thing between Marketing and the
    // timestamps every registration window is derived from.
    const club = await makeClub();
    const lead = await makeActiveLead(app, club.id);
    const marketing = await makeActiveOfficer(app, club.id, 'MARKETING');
    const event = await mkEvent(club.id, lead.userId);

    const allowed = await patch(marketing.sessionCookie, event.id, { title: 'Renamed Night' });
    expect(allowed.status).toBe(200);
    expect(allowed.body.title).toBe('Renamed Night');

    const refused = await patch(marketing.sessionCookie, event.id, { startsAt: at(30 * DAY) });
    expect(refused.status).toBe(403);
    // The status alone would pass against a route that simply refused
    // Marketing outright, which is the behaviour this stage replaced.
    expect(refused.body.detail).toBe('You do not have permission to change startsAt.');
    expect((await prisma.event.findUniqueOrThrow({ where: { id: event.id } })).startsAt).toEqual(
      event.startsAt,
    );
  });

  it('refuses lowering capacity below the confirmed count', async () => {
    // Spec 7.4: students are never silently cancelled. Refused by the service
    // with its own message before event_capacity_bounds would fire, which
    // would otherwise surface as the filter's generic conflict text.
    const club = await makeClub();
    const lead = await makeActiveLead(app, club.id);
    const event = await mkEvent(club.id, lead.userId, { capacity: 10, confirmedCount: 4 });

    const res = await patch(lead.sessionCookie, event.id, { capacity: 3 });
    expect(res.status).toBe(422);
    expect(res.body.detail).toBe('Capacity cannot be lower than the 4 students already confirmed.');
    expect((await prisma.event.findUniqueOrThrow({ where: { id: event.id } })).capacity).toBe(10);
  });
});

describe('event lifecycle transitions that must be refused', () => {
  it('refuses publishing from a suspended club and publishing a cancelled event', async () => {
    const suspended = await makeClub({ status: 'SUSPENDED' });
    const suspendedLead = await makeActiveLead(app, suspended.id);
    const draft = await mkEvent(suspended.id, suspendedLead.userId, { status: 'DRAFT' });

    const fromSuspended = await publish(suspendedLead.sessionCookie, draft.id);
    expect(fromSuspended.status).toBe(422);
    expect(fromSuspended.body.detail).toBe('That club is not accepting new activity.');
    expect((await prisma.event.findUniqueOrThrow({ where: { id: draft.id } })).status).toBe('DRAFT');

    const club = await makeClub();
    const lead = await makeActiveLead(app, club.id);
    const cancelled = await mkEvent(club.id, lead.userId, { status: 'CANCELLED' });

    const fromCancelled = await publish(lead.sessionCookie, cancelled.id);
    expect(fromCancelled.status).toBe(422);
    expect(fromCancelled.body.detail).toBe('That event was cancelled.');
  });

  it('refuses cancelling an event that has already issued certificates', async () => {
    const club = await makeClub();
    const lead = await makeActiveLead(app, club.id);
    const certified = await mkEvent(club.id, lead.userId, { status: 'CERTIFIED' });

    const res = await request(app.getHttpServer())
      .post(`${API_PREFIX}/events/${certified.id}/cancel`)
      .set('Cookie', lead.sessionCookie)
      .send({ reason: 'Changed our minds.' });

    expect(res.status).toBe(422);
    expect(res.body.detail).toBe('That event has issued certificates and is final.');
    expect((await prisma.event.findUniqueOrThrow({ where: { id: certified.id } })).status).toBe('CERTIFIED');
  });
});

describe('lazy lifecycle', () => {
  it('advances on a single read and then does nothing on the next one', async () => {
    const club = await makeClub();
    const lead = await makeActiveLead(app, club.id);
    const event = await mkEvent(club.id, lead.userId, { status: 'PUBLISHED', ...CLOSED_WINDOW });
    const student = await loginAsStudent(app);

    const first = await detail(student.sessionCookie, event.id);
    expect(first.status).toBe(200);
    expect(first.body.status).toBe('REGISTRATION_CLOSED');

    const hops = () =>
      prisma.auditLog.count({ where: { entityId: event.id, action: 'event.status_advanced' } });
    expect(await hops()).toBe(1);

    // Idempotence is the whole point: advance is called on every read, so a
    // version that re-applied the transition would write an audit row per
    // page view and eventually walk the event off the end of the chain.
    expect((await detail(student.sessionCookie, event.id)).body.status).toBe('REGISTRATION_CLOSED');
    expect(await hops()).toBe(1);
  });

  it('never advances a draft or a cancelled event, whatever the clock says', async () => {
    const club = await makeClub();
    const lead = await makeActiveLead(app, club.id);
    const draft = await mkEvent(club.id, lead.userId, { status: 'DRAFT', ...CLOSED_WINDOW });
    const cancelled = await mkEvent(club.id, lead.userId, { status: 'CANCELLED', ...CLOSED_WINDOW });

    expect((await detail(lead.sessionCookie, draft.id)).body.status).toBe('DRAFT');
    expect((await detail(lead.sessionCookie, cancelled.id)).body.status).toBe('CANCELLED');
  });
});

describe('POST /internal/lifecycle-sweep', () => {
  const sweep = (secret?: string) => {
    const req = request(app.getHttpServer()).post(`${API_PREFIX}/internal/lifecycle-sweep`);
    return secret === undefined ? req : req.set(SWEEP_SECRET_HEADER, secret);
  };

  it('refuses a wrong secret and a missing one', async () => {
    const wrong = await sweep('not-the-secret-at-all');
    expect(wrong.status).toBe(401);
    expect(wrong.body.detail).toBe('That sweep secret is not valid.');
    expect((await sweep()).status).toBe(401);
  });

  it('advances the events nobody read', async () => {
    const club = await makeClub();
    const lead = await makeActiveLead(app, club.id);
    const due = await mkEvent(club.id, lead.userId, { status: 'PUBLISHED', ...CLOSED_WINDOW });
    const notDue = await mkEvent(club.id, lead.userId, { status: 'PUBLISHED' });
    // Already where its timestamps say it should be, and still inside the
    // candidate query's window. Counting this one as advanced would make the
    // sweep's own report useless as a signal that anything happened.
    const current = await mkEvent(club.id, lead.userId, {
      status: 'REGISTRATION_CLOSED',
      ...CLOSED_WINDOW,
    });

    const res = await sweep(EXAMPLE_LIFECYCLE_SWEEP_SECRET);
    expect(res.status).toBe(200);
    expect(res.body.advanced).toBe(1);
    expect((await prisma.event.findUniqueOrThrow({ where: { id: due.id } })).status).toBe('REGISTRATION_CLOSED');
    // The counterpart matters as much: a sweep that advanced every published
    // event would close registration on one that has not opened yet.
    expect((await prisma.event.findUniqueOrThrow({ where: { id: notDue.id } })).status).toBe('PUBLISHED');
    expect(
      await prisma.auditLog.count({ where: { entityId: current.id, action: 'event.status_advanced' } }),
    ).toBe(0);
  });
});

describe('draft visibility', () => {
  it('hides a draft from a student and shows it to the club team', async () => {
    const club = await makeClub();
    const lead = await makeActiveLead(app, club.id);
    const draft = await mkEvent(club.id, lead.userId, { status: 'DRAFT' });
    const student = await loginAsStudent(app);

    // 404 rather than 403: telling a student the draft exists is the leak.
    expect((await detail(student.sessionCookie, draft.id)).status).toBe(404);
    const list = await request(app.getHttpServer())
      .get(`${API_PREFIX}/events`)
      .set('Cookie', student.sessionCookie);
    expect(list.body.items).toHaveLength(0);

    expect((await detail(lead.sessionCookie, draft.id)).status).toBe(200);
    const admin = await loginAsAdmin(app);
    expect((await detail(admin.sessionCookie, draft.id)).status).toBe(200);
  });
});

describe('DELETE /events/:eventId/assignments/:assignmentId', () => {
  it("refuses an assignment id that belongs to another club's event", async () => {
    // A permission scoped to event A cannot authorise a row on event B. The
    // handler loads by { id, eventId }, not by id alone.
    const clubA = await makeClub();
    const clubB = await makeClub();
    const leadA = await makeActiveLead(app, clubA.id);
    const leadB = await makeActiveLead(app, clubB.id);
    const eventA = await mkEvent(clubA.id, leadA.userId);
    const eventB = await mkEvent(clubB.id, leadB.userId);

    const onB = await request(app.getHttpServer())
      .post(`${API_PREFIX}/events/${eventB.id}/assignments`)
      .set('Cookie', leadB.sessionCookie)
      .send({ userId: leadB.userId, responsibility: 'OPERATIONS' });
    expect(onB.status).toBe(201);

    const res = await request(app.getHttpServer())
      .delete(`${API_PREFIX}/events/${eventA.id}/assignments/${onB.body.id}`)
      .set('Cookie', leadA.sessionCookie);

    expect(res.status).toBe(404);
    expect(res.body.detail).toBe('No such assignment.');
    expect(await prisma.eventAssignment.count({ where: { id: onB.body.id } })).toBe(1);
  });
});

describe('field permissions on the poster upload route', () => {
  // The route is gated by event:edit, which admits all five club roles, but
  // posterUploaded is Marketing-only. Without the field gate in
  // EventsService.mintEditUpload, a CTO or Operations officer mints a signed
  // URL and overwrites the live poster object at events/<id>/poster.webp.
  it.each(['CTO', 'OPERATIONS'] as const)('refuses %s a poster upload URL', async (role) => {
    const club = await makeClub();
    const lead = await makeActiveLead(app, club.id);
    const event = await mkEvent(club.id, lead.userId);
    const officer = await makeActiveOfficer(app, club.id, role);

    const res = await request(app.getHttpServer())
      .post(`${API_PREFIX}/events/${event.id}/poster-upload-url`)
      .set('Cookie', officer.sessionCookie);

    expect(res.status).toBe(403);
    expect(res.body.detail).toBe('You do not have permission to change posterUploaded.');
  });

  it('still lets Marketing mint one', async () => {
    const club = await makeClub();
    const lead = await makeActiveLead(app, club.id);
    const event = await mkEvent(club.id, lead.userId);
    const marketing = await makeActiveOfficer(app, club.id, 'MARKETING');

    const res = await request(app.getHttpServer())
      .post(`${API_PREFIX}/events/${event.id}/poster-upload-url`)
      .set('Cookie', marketing.sessionCookie);

    expect(res.status).toBe(201);
  });
});

describe('admin override reason', () => {
  // Spec 6.1: "Every Admin override requires a recorded reason and writes an
  // audit row in the same transaction as the overridden action." Before this,
  // an Admin edit wrote event.updated with reason null.
  it('refuses an admin edit with no reason, and records it when given', async () => {
    const club = await makeClub();
    const lead = await makeActiveLead(app, club.id);
    const event = await mkEvent(club.id, lead.userId);
    const admin = await loginAsAdmin(app);

    const bare = await request(app.getHttpServer())
      .patch(`${API_PREFIX}/events/${event.id}`)
      .set('Cookie', admin.sessionCookie)
      .send({ title: 'Renamed by admin' });

    expect(bare.status).toBe(422);
    expect(bare.body.detail).toBe('An admin override requires a reason.');

    const withReason = await request(app.getHttpServer())
      .patch(`${API_PREFIX}/events/${event.id}`)
      .set('Cookie', admin.sessionCookie)
      .send({ title: 'Renamed by admin', overrideReason: 'Reported title breached policy.' });

    expect(withReason.status).toBe(200);
    const row = await prisma.auditLog.findFirst({
      where: { action: 'event.updated', entityId: event.id },
      orderBy: { createdAt: 'desc' },
    });
    expect(row?.reason).toBe('Reported title breached policy.');
  });

  it('does not ask a club Lead for one', async () => {
    const club = await makeClub();
    const lead = await makeActiveLead(app, club.id);
    const event = await mkEvent(club.id, lead.userId);

    const res = await request(app.getHttpServer())
      .patch(`${API_PREFIX}/events/${event.id}`)
      .set('Cookie', lead.sessionCookie)
      .send({ title: 'Renamed by the lead' });

    expect(res.status).toBe(200);
  });
});
