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

  /**
   * The mint overwrites the live public object at events/<id>/poster.webp, so
   * it is an edit and takes PATCH /events/:eventId's status gate. Before
   * Stage 8 it refused nothing, which made it the one edit path a cancelled
   * or completed event still accepted, and nothing recorded it.
   */
  it('refuses a cancelled event and records the mint it allows', async () => {
    const club = await makeClub();
    const lead = await makeActiveLead(app, club.id);
    const cancelled = await mkEvent(club.id, lead.userId, { status: 'CANCELLED' });

    const refused = await request(app.getHttpServer())
      .post(`${API_PREFIX}/events/${cancelled.id}/poster-upload-url`)
      .set('Cookie', lead.sessionCookie);

    expect(refused.status).toBe(422);
    expect(refused.body.detail).toBe('A cancelled event can no longer be edited.');

    const live = await mkEvent(club.id, lead.userId);
    const allowed = await request(app.getHttpServer())
      .post(`${API_PREFIX}/events/${live.id}/poster-upload-url`)
      .set('Cookie', lead.sessionCookie);

    expect(allowed.status).toBe(201);
    // The bytes never pass through the API, so this row is the only record
    // the object was replaced at all.
    const rows = await prisma.auditLog.findMany({
      where: { entityId: live.id, action: 'event.upload_url_minted' },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.actorUserId).toBe(lead.userId);
    // Nothing is recorded for the refusal: that transaction rolled back.
    expect(
      await prisma.auditLog.count({ where: { entityId: cancelled.id, action: 'event.upload_url_minted' } }),
    ).toBe(0);
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

describe('admin override reason on create, publish, assign and unassign', () => {
  // Spec 6.1 makes all four "override" rows for an Admin. Before this, each
  // wrote its audit row with reason null, and the only path that asked was
  // the patch.
  const NEW_EVENT = () => ({
    eventId: crypto.randomUUID(),
    title: 'Admin Night',
    summary: 'Run by the university.',
    description: 'Something happens.',
    eventType: 'Workshop',
    audience: 'All students',
    startsAt: at(7 * DAY),
    endsAt: at(7 * DAY + 2 * HOUR),
    registrationOpensAt: at(-DAY),
    registrationClosesAt: at(6 * DAY),
    capacity: 20,
  });

  const reasonOf = (action: string, entityId: string) =>
    prisma.auditLog
      .findFirst({ where: { action, entityId }, orderBy: { createdAt: 'desc' } })
      .then((row) => row?.reason ?? null);

  it('refuses each one bare and records the reason when given', async () => {
    const club = await makeClub();
    const lead = await makeActiveLead(app, club.id);
    const admin = await loginAsAdmin(app);

    const create = (body: object) =>
      request(app.getHttpServer())
        .post(`${API_PREFIX}/clubs/${club.id}/events`)
        .set('Cookie', admin.sessionCookie)
        .send(body);

    const bareCreate = await create(NEW_EVENT());
    expect(bareCreate.status).toBe(422);
    expect(bareCreate.body.detail).toBe('An admin override requires a reason.');
    // The refusal is thrown inside the transaction, so nothing is left behind.
    expect(await prisma.event.count()).toBe(0);

    const created = await create({ ...NEW_EVENT(), overrideReason: 'Faculty-run event.' });
    expect(created.status).toBe(201);
    expect(await reasonOf('event.created', created.body.id)).toBe('Faculty-run event.');
    const eventId = created.body.id as string;

    const barePublish = await publish(admin.sessionCookie, eventId);
    expect(barePublish.status).toBe(422);
    expect(barePublish.body.detail).toBe('An admin override requires a reason.');
    expect((await prisma.event.findUniqueOrThrow({ where: { id: eventId } })).status).toBe('DRAFT');

    const published = await request(app.getHttpServer())
      .post(`${API_PREFIX}/events/${eventId}/publish`)
      .set('Cookie', admin.sessionCookie)
      .send({ overrideReason: 'Dean asked for it to go live.' });
    expect(published.status).toBe(201);
    expect(await reasonOf('event.published', eventId)).toBe('Dean asked for it to go live.');

    const assign = (body: object) =>
      request(app.getHttpServer())
        .post(`${API_PREFIX}/events/${eventId}/assignments`)
        .set('Cookie', admin.sessionCookie)
        .send(body);

    const bareAssign = await assign({ userId: lead.userId, responsibility: 'OPERATIONS' });
    expect(bareAssign.status).toBe(422);
    expect(bareAssign.body.detail).toBe('An admin override requires a reason.');
    expect(await prisma.eventAssignment.count()).toBe(0);

    const assigned = await assign({
      userId: lead.userId,
      responsibility: 'OPERATIONS',
      overrideReason: 'Nobody in the club could scan.',
    });
    expect(assigned.status).toBe(201);
    expect(await reasonOf('event.responsibility_assigned', assigned.body.id)).toBe(
      'Nobody in the club could scan.',
    );

    const unassign = (body: object) =>
      request(app.getHttpServer())
        .delete(`${API_PREFIX}/events/${eventId}/assignments/${assigned.body.id}`)
        .set('Cookie', admin.sessionCookie)
        .send(body);

    const bareRemove = await unassign({});
    expect(bareRemove.status).toBe(422);
    expect(bareRemove.body.detail).toBe('An admin override requires a reason.');
    expect(await prisma.eventAssignment.count()).toBe(1);

    const removed = await unassign({ overrideReason: 'Assigned in error.' });
    expect(removed.status).toBe(204);
    expect(await reasonOf('event.responsibility_removed', assigned.body.id)).toBe('Assigned in error.');
  });

  it('asks a club Lead for none of it', async () => {
    // The counterpart. A gate that demanded a reason from everyone would pass
    // every assertion above and make the console unusable for its own club.
    const club = await makeClub();
    const lead = await makeActiveLead(app, club.id);

    const created = await request(app.getHttpServer())
      .post(`${API_PREFIX}/clubs/${club.id}/events`)
      .set('Cookie', lead.sessionCookie)
      .send(NEW_EVENT());
    expect(created.status).toBe(201);
    expect(await reasonOf('event.created', created.body.id)).toBeNull();

    expect((await publish(lead.sessionCookie, created.body.id)).status).toBe(201);

    const assigned = await request(app.getHttpServer())
      .post(`${API_PREFIX}/events/${created.body.id}/assignments`)
      .set('Cookie', lead.sessionCookie)
      .send({ userId: lead.userId, responsibility: 'OPERATIONS' });
    expect(assigned.status).toBe(201);

    const removed = await request(app.getHttpServer())
      .delete(`${API_PREFIX}/events/${created.body.id}/assignments/${assigned.body.id}`)
      .set('Cookie', lead.sessionCookie)
      .send({});
    expect(removed.status).toBe(204);
  });
});

describe('GET /events renders the due status without writing it', () => {
  it('reports a closed registration window that nobody has opened yet', async () => {
    // The plan: "GET /events renders dueStatus as a pure function without
    // writing; the sweep endpoint persists in bulk." Reading row.status
    // straight through makes a list say PUBLISHED while the detail page and
    // the register route both say the window has closed.
    const club = await makeClub();
    const lead = await makeActiveLead(app, club.id);
    const event = await mkEvent(club.id, lead.userId, { status: 'PUBLISHED', ...CLOSED_WINDOW });
    const student = await loginAsStudent(app);

    const list = await request(app.getHttpServer())
      .get(`${API_PREFIX}/events`)
      .set('Cookie', student.sessionCookie);

    expect(list.status).toBe(200);
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0].status).toBe('REGISTRATION_CLOSED');

    // The other half: a list read must not advance anything. One transaction
    // per row on the hottest read in the product is what the pure function is
    // there to avoid.
    expect((await prisma.event.findUniqueOrThrow({ where: { id: event.id } })).status).toBe('PUBLISHED');
    expect(
      await prisma.auditLog.count({ where: { entityId: event.id, action: 'event.status_advanced' } }),
    ).toBe(0);
  });
});

describe('advance under a concurrent transition', () => {
  it('does not replay the walk when another writer got there first', async () => {
    // Each hop is conditional on the status this walk believes the row is in.
    // An unconditional update lets a transaction holding a stale read rewrite
    // the status and file a second transition history for one transition.
    const club = await makeClub();
    const lead = await makeActiveLead(app, club.id);
    const event = await mkEvent(club.id, lead.userId, { status: 'PUBLISHED', ...CLOSED_WINDOW });
    const student = await loginAsStudent(app);

    // Holding the row lock from outside pins the read the request has already
    // made, so the transition lands between that read and its write. Without
    // it the window is microseconds wide and the race never reproduces.
    // The in-flight request must NOT be returned from the callback: Prisma
    // awaits what the callback returns before committing, and the request is
    // waiting on that commit.
    let inFlight!: Promise<request.Response>;
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM "event" WHERE "id" = ${event.id}::uuid FOR UPDATE`;
      inFlight = detail(student.sessionCookie, event.id).then((r) => r);
      await new Promise((resolve) => setTimeout(resolve, 300));
      await tx.$executeRaw`UPDATE "event" SET "status" = 'REGISTRATION_CLOSED' WHERE "id" = ${event.id}::uuid`;
    });
    const read = await inFlight;

    expect(read.status).toBe(200);
    expect(read.body.status).toBe('REGISTRATION_CLOSED');
    expect((await prisma.event.findUniqueOrThrow({ where: { id: event.id } })).status).toBe(
      'REGISTRATION_CLOSED',
    );
    // The transition above was made by the other writer, so the request must
    // have recorded none of its own.
    expect(
      await prisma.auditLog.count({ where: { entityId: event.id, action: 'event.status_advanced' } }),
    ).toBe(0);
  });
});

describe('reopening a registration window', () => {
  it('refuses to move the close time forward once registration has closed', async () => {
    // advanceRow walks forward only, deliberately: attendance must not be
    // undone. So a 200 here saved a date the lifecycle will never honour and
    // left the officer a field that contradicts the refusal students see.
    const club = await makeClub();
    const lead = await makeActiveLead(app, club.id);
    const event = await mkEvent(club.id, lead.userId, { status: 'REGISTRATION_CLOSED', ...CLOSED_WINDOW });

    const res = await patch(lead.sessionCookie, event.id, { registrationClosesAt: at(DAY + HOUR) });

    expect(res.status).toBe(422);
    expect(res.body.detail).toBe('Registration cannot be reopened once it has closed.');
    expect(
      (await prisma.event.findUniqueOrThrow({ where: { id: event.id } })).registrationClosesAt,
    ).toEqual(event.registrationClosesAt);
  });

  it('still lets a PUBLISHED event move its close time', async () => {
    // The counterpart: a blanket refusal of registrationClosesAt passes the
    // test above and takes the field away from every live event.
    const club = await makeClub();
    const lead = await makeActiveLead(app, club.id);
    const event = await mkEvent(club.id, lead.userId, { status: 'PUBLISHED' });

    const res = await patch(lead.sessionCookie, event.id, { registrationClosesAt: at(5 * DAY) });
    expect(res.status).toBe(200);
  });
});

describe('the sweep, on rows the existing case does not reach', () => {
  const sweepAll = () =>
    request(app.getHttpServer())
      .post(`${API_PREFIX}/internal/lifecycle-sweep`)
      .set(SWEEP_SECRET_HEADER, EXAMPLE_LIFECYCLE_SWEEP_SECRET);

  it('picks up an event whose check-in opened while registration is still open', async () => {
    // registration_closes_at <= ends_at is the only constraint, and the
    // default check-in window opens 60 minutes before the start, so an event
    // whose registration closes at its end time has check-in opening first.
    // Without the checkInOpensAt candidate clause the sweep never sees it and
    // it stays PUBLISHED, which is to say unscannable.
    const club = await makeClub();
    const lead = await makeActiveLead(app, club.id);
    const event = await mkEvent(club.id, lead.userId, {
      status: 'PUBLISHED',
      registrationOpensAt: new Date(Date.now() - DAY),
      registrationClosesAt: new Date(Date.now() + 2 * HOUR),
      startsAt: new Date(Date.now() + HOUR),
      endsAt: new Date(Date.now() + 3 * HOUR),
      checkInOpensAt: new Date(Date.now() - 10 * 60 * 1000),
      checkInClosesAt: new Date(Date.now() + 4 * HOUR),
    });

    const res = await sweepAll();
    expect(res.status).toBe(200);
    expect(res.body.advanced).toBe(1);
    expect((await prisma.event.findUniqueOrThrow({ where: { id: event.id } })).status).toBe('ONGOING');
  });

  it('does not count an event whose due status is behind its current one', async () => {
    // A boundary moved into the future. advanceRow's loop never runs, so
    // nothing changes; counting the call rather than its result reported one
    // advanced event on every run, forever.
    const club = await makeClub();
    const lead = await makeActiveLead(app, club.id);
    const event = await mkEvent(club.id, lead.userId, {
      status: 'ONGOING',
      registrationOpensAt: new Date(Date.now() - 2 * DAY),
      registrationClosesAt: new Date(Date.now() - HOUR),
      startsAt: new Date(Date.now() + DAY),
      endsAt: new Date(Date.now() + DAY + 2 * HOUR),
      checkInOpensAt: new Date(Date.now() + DAY - HOUR),
      checkInClosesAt: new Date(Date.now() + DAY + 3 * HOUR),
    });

    const res = await sweepAll();
    expect(res.status).toBe(200);
    expect(res.body.scanned).toBe(1);
    expect(res.body.advanced).toBe(0);
    expect((await prisma.event.findUniqueOrThrow({ where: { id: event.id } })).status).toBe('ONGOING');
    expect(
      await prisma.auditLog.count({ where: { entityId: event.id, action: 'event.status_advanced' } }),
    ).toBe(0);
  });
});

describe('draft visibility for an event assignee', () => {
  it('shows a draft to someone assigned to it who holds no club role', async () => {
    // The third branch of both the list filter and the detail gate. The two
    // cases already covered (a club officer, an Admin) both pass with it gone.
    const club = await makeClub();
    const lead = await makeActiveLead(app, club.id);
    const draft = await mkEvent(club.id, lead.userId, { status: 'DRAFT' });
    const helper = await loginAsStudent(app);

    const assigned = await request(app.getHttpServer())
      .post(`${API_PREFIX}/events/${draft.id}/assignments`)
      .set('Cookie', lead.sessionCookie)
      .send({ userId: helper.userId, responsibility: 'OPERATIONS' });
    expect(assigned.status).toBe(201);

    expect((await detail(helper.sessionCookie, draft.id)).status).toBe(200);
    const list = await request(app.getHttpServer())
      .get(`${API_PREFIX}/events`)
      .set('Cookie', helper.sessionCookie);
    expect(list.body.items.map((e: { id: string }) => e.id)).toEqual([draft.id]);
  });
});

describe('GET /events/:eventId/assignments', () => {
  it('pages rather than returning everything', async () => {
    // Spec 8: no unbounded list, anywhere. Without a take, limit=1 returns
    // both rows and there is no cursor to ask for a second page with.
    const club = await makeClub();
    const lead = await makeActiveLead(app, club.id);
    const event = await mkEvent(club.id, lead.userId);
    const [one, two] = await Promise.all([loginAsStudent(app), loginAsStudent(app)]);

    for (const person of [one!, two!]) {
      const res = await request(app.getHttpServer())
        .post(`${API_PREFIX}/events/${event.id}/assignments`)
        .set('Cookie', lead.sessionCookie)
        .send({ userId: person.userId, responsibility: 'OPERATIONS' });
      expect(res.status).toBe(201);
    }

    const first = await request(app.getHttpServer())
      .get(`${API_PREFIX}/events/${event.id}/assignments?limit=1`)
      .set('Cookie', lead.sessionCookie);
    expect(first.status).toBe(200);
    expect(first.body.items).toHaveLength(1);
    expect(first.body.nextCursor).toBe(first.body.items[0].id);

    const second = await request(app.getHttpServer())
      .get(`${API_PREFIX}/events/${event.id}/assignments?limit=1&cursor=${first.body.nextCursor}`)
      .set('Cookie', lead.sessionCookie);
    expect(second.body.items).toHaveLength(1);
    expect(second.body.items[0].id).not.toBe(first.body.items[0].id);
    expect(second.body.nextCursor).toBeNull();
  });
});

describe('GET /events?q=', () => {
  /**
   * The trigram GIN index on `event.title` (20260914175400_perf_indexes) is a
   * pure optimisation, so this asserts the SET of titles the filter matches,
   * not its speed. An index that changes results is not an optimisation, and
   * `gin_trgm_ops` has two ways of changing them that a "finds the event"
   * test would sail past:
   *
   * - a term shorter than three characters produces no trigram, so the
   *   planner must fall back to the sequential ILIKE. A setup that let the
   *   index answer alone returns nothing for `ni`.
   * - `%` and `_` are ILIKE wildcards, and the filter wraps the term in `%`
   *   without escaping it, so `_` still matches any single character. The
   *   index must not narrow that.
   */
  async function titlesFor(cookie: string, q: string): Promise<string[]> {
    const res = await request(app.getHttpServer())
      .get(`${API_PREFIX}/events?q=${encodeURIComponent(q)}`)
      .set('Cookie', cookie);
    expect(res.status).toBe(200);
    return (res.body.items as { title: string }[]).map((e) => e.title).sort();
  }

  it('matches the same titles a sequential ILIKE would', async () => {
    const club = await makeClub();
    const lead = await makeActiveLead(app, club.id);
    for (const title of ['Robotics Night', 'robotics workshop', 'Night Market', 'Chess Open']) {
      await mkEvent(club.id, lead.userId, { status: 'PUBLISHED', title });
    }
    const student = await loginAsStudent(app);
    const cookie = student.sessionCookie;

    // Case-insensitive, and a substring that starts mid-word.
    expect(await titlesFor(cookie, 'robot')).toEqual(['Robotics Night', 'robotics workshop']);
    expect(await titlesFor(cookie, 'ROBOTICS')).toEqual(['Robotics Night', 'robotics workshop']);
    expect(await titlesFor(cookie, 'otics')).toEqual(['Robotics Night', 'robotics workshop']);

    // Spans two words, so no single trigram covers it.
    expect(await titlesFor(cookie, 'Robotics N')).toEqual(['Robotics Night']);

    // Below the three-character trigram floor.
    expect(await titlesFor(cookie, 'ni')).toEqual(['Night Market', 'Robotics Night']);

    // `_` is still an ILIKE wildcard, matching the space in 'Chess Open'.
    expect(await titlesFor(cookie, 'chess_open')).toEqual(['Chess Open']);

    expect(await titlesFor(cookie, 'quantum')).toEqual([]);
  });
});
