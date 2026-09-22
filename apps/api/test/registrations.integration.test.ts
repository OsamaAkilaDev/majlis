import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { API_PREFIX } from '../src/config/api-prefix';
import { createTestApp } from './app';
import { loginAsAdmin, loginAsStudent, type LoggedInUser } from './auth-helpers';
import { createTestPrisma, disconnectTestPrisma, truncateAll } from './db';
import { makeActiveLead, makeActiveOfficer, makeClub, mkEvent, mkRegistration, uniq } from './factories';

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

function register(cookie: string, eventId: string, body: object = {}) {
  return request(app.getHttpServer())
    .post(`${API_PREFIX}/events/${eventId}/registrations`)
    .set('Cookie', cookie)
    .send(body);
}

function cancel(cookie: string, eventId: string) {
  return request(app.getHttpServer())
    .delete(`${API_PREFIX}/events/${eventId}/registrations/me`)
    .set('Cookie', cookie);
}

function students(n: number): Promise<LoggedInUser[]> {
  return Promise.all(Array.from({ length: n }, () => loginAsStudent(app)));
}

/** A club with an active Lead and a live event, which is most of these tests' setup. */
async function anOpenEvent(overrides: Record<string, unknown> = {}) {
  const club = await makeClub();
  const lead = await makeActiveLead(app, club.id);
  const event = await mkEvent(club.id, lead.userId, overrides);
  return { club, lead, event };
}

describe('the last seat, under real concurrency', () => {
  it('admits exactly one student when five race for one seat', async () => {
    // Promise.all over five distinct users forces the race: a sequential pair
    // passes against a read-then-write with no row lock, because only real
    // concurrency puts two transactions between reading and incrementing
    // confirmed_count.
    const { event } = await anOpenEvent({ capacity: 1, waitlistEnabled: true });
    const racers = await students(5);

    const results = await Promise.all(racers.map((s) => register(s.sessionCookie, event.id)));
    expect(results.map((r) => r.status)).toEqual([201, 201, 201, 201, 201]);

    const confirmed = await prisma.eventRegistration.findMany({
      where: { eventId: event.id, status: 'CONFIRMED' },
    });
    expect(confirmed).toHaveLength(1);

    const after = await prisma.event.findUniqueOrThrow({ where: { id: event.id } });
    expect(after.confirmedCount).toBe(1);

    // Catches a waitlist position assigned outside the row lock, which puts two
    // students at position 1 and leaves the promotion order undefendable.
    const waitlisted = await prisma.eventRegistration.findMany({
      where: { eventId: event.id, status: 'WAITLISTED' },
      orderBy: { waitlistPosition: 'asc' },
    });
    expect(waitlisted.map((r) => r.waitlistPosition)).toEqual([1, 2, 3, 4]);
  });

  it('returns 409 when a full event has no waitlist', async () => {
    const { event } = await anOpenEvent({ capacity: 1, waitlistEnabled: false });
    const [first, second] = await students(2);

    expect((await register(first!.sessionCookie, event.id)).body.status).toBe('CONFIRMED');
    const res = await register(second!.sessionCookie, event.id);

    expect(res.status).toBe(409);
    // The filter maps a stray P2002 to a generic 409 too, so the status alone
    // proves nothing about which branch ran.
    expect(res.body.detail).toBe('That event is full and has no waitlist.');
    expect(await prisma.eventRegistration.count({ where: { eventId: event.id } })).toBe(1);
  });
});

describe('waitlist ordering and promotion', () => {
  it('promotes the head of the queue when a confirmed student cancels', async () => {
    const { event } = await anOpenEvent({ capacity: 1, waitlistEnabled: true });
    const [holder, first, second] = await students(3);

    expect((await register(holder!.sessionCookie, event.id)).body.status).toBe('CONFIRMED');
    expect((await register(first!.sessionCookie, event.id)).body.waitlistPosition).toBe(1);
    expect((await register(second!.sessionCookie, event.id)).body.waitlistPosition).toBe(2);

    expect((await cancel(holder!.sessionCookie, event.id)).status).toBe(204);

    const rows = await prisma.eventRegistration.findMany({ where: { eventId: event.id } });
    const byUser = new Map(rows.map((r) => [r.userId, r]));
    // Position 1, not 2 and not both: the order is why this is a queue.
    expect(byUser.get(first!.userId)?.status).toBe('CONFIRMED');
    expect(byUser.get(first!.userId)?.promotedAt).not.toBeNull();
    expect(byUser.get(second!.userId)?.status).toBe('WAITLISTED');
    expect(byUser.get(holder!.userId)?.status).toBe('CANCELLED');

    // Catches a decrement with no re-increment on promotion, which leaves the
    // event permanently under-filled.
    expect((await prisma.event.findUniqueOrThrow({ where: { id: event.id } })).confirmedCount).toBe(1);
  });

  it('does not free a seat when a waitlisted student cancels', async () => {
    // Catches a handler decrementing the counter for every cancellation, which
    // pushes the event over capacity on the next registration.
    const { event } = await anOpenEvent({ capacity: 1, waitlistEnabled: true });
    const [holder, queued] = await students(2);

    await register(holder!.sessionCookie, event.id);
    await register(queued!.sessionCookie, event.id);
    expect((await cancel(queued!.sessionCookie, event.id)).status).toBe(204);

    expect((await prisma.event.findUniqueOrThrow({ where: { id: event.id } })).confirmedCount).toBe(1);
  });

  it('promotes from the waitlist when a Lead raises capacity', async () => {
    const { lead, event } = await anOpenEvent({ capacity: 1, waitlistEnabled: true });
    const [holder, first, second] = await students(3);

    await register(holder!.sessionCookie, event.id);
    await register(first!.sessionCookie, event.id);
    await register(second!.sessionCookie, event.id);

    const res = await request(app.getHttpServer())
      .patch(`${API_PREFIX}/events/${event.id}`)
      .set('Cookie', lead.sessionCookie)
      .send({ capacity: 3 });
    expect(res.status).toBe(200);

    const after = await prisma.event.findUniqueOrThrow({ where: { id: event.id } });
    expect(after.confirmedCount).toBe(3);
    expect(
      await prisma.eventRegistration.count({ where: { eventId: event.id, status: 'WAITLISTED' } }),
    ).toBe(0);
  });
});

describe('the registration window', () => {
  it('refuses before it opens and after it closes', async () => {
    const notYet = await anOpenEvent({
      registrationOpensAt: new Date(Date.now() + HOUR),
      registrationClosesAt: new Date(Date.now() + 5 * DAY),
    });
    const student = await loginAsStudent(app);
    const early = await register(student.sessionCookie, notYet.event.id);
    expect(early.status).toBe(422);
    expect(early.body.detail).toBe('Registration for that event has not opened yet.');

    // Closed a second ago but not yet swept: the window check must stand alone,
    // not lean on the lifecycle having moved the status.
    const over = await anOpenEvent({
      registrationOpensAt: new Date(Date.now() - 2 * DAY),
      registrationClosesAt: new Date(Date.now() - 1000),
    });
    const late = await register(student.sessionCookie, over.event.id);
    expect(late.status).toBe(422);
    expect(late.body.detail).toBe('Registration for that event has closed.');

    expect(await prisma.eventRegistration.count()).toBe(0);
  });

  it('refuses a cancelled event and hides a draft', async () => {
    const cancelled = await anOpenEvent({ status: 'CANCELLED' });
    const draft = await anOpenEvent({ status: 'DRAFT' });
    const student = await loginAsStudent(app);

    const onCancelled = await register(student.sessionCookie, cancelled.event.id);
    expect(onCancelled.status).toBe(422);
    expect(onCancelled.body.detail).toBe('That event was cancelled.');

    // 404, not 403: the refusal must not confirm the draft exists.
    expect((await register(student.sessionCookie, draft.event.id)).status).toBe(404);
  });
});

describe('eligibility and the Admin override', () => {
  it('refuses a non-member of a members-only event and lets an Admin override with a reason', async () => {
    const { club, event } = await anOpenEvent({ requiresClubMembership: true, capacity: 5 });
    const outsider = await loginAsStudent(app);
    const admin = await loginAsAdmin(app);

    const refused = await register(outsider.sessionCookie, event.id);
    expect(refused.status).toBe(422);
    expect(refused.body.detail).toBe('You must be a member of that club to register for this event.');

    const overridden = await register(admin.sessionCookie, event.id, {
      userId: outsider.userId,
      overrideReason: 'Invited speaker, not a member.',
    });
    expect(overridden.status).toBe(201);
    expect(overridden.body.status).toBe('CONFIRMED');
    expect(overridden.body.source).toBe('ADMIN_OVERRIDE');

    // Every admin override records a reason in the same transaction.
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'event.registration_overridden' },
    });
    expect(audit.reason).toBe('Invited speaker, not a member.');
    expect(audit.actorUserId).toBe(admin.userId);
    expect(club.id).toBeTruthy();
  });

  it('refuses a student trying to register somebody else', async () => {
    const { event } = await anOpenEvent();
    const [actor, victim] = await students(2);

    const res = await register(actor!.sessionCookie, event.id, {
      userId: victim!.userId,
      overrideReason: 'Because I said so.',
    });

    expect(res.status).toBe(403);
    expect(res.body.detail).toBe('Only an administrator may register someone else.');
    expect(await prisma.eventRegistration.count({ where: { userId: victim!.userId } })).toBe(0);
  });

  it('returns the same registration when a student registers twice', async () => {
    // Registration is idempotent, and 409 is reserved for full-with-no-waitlist,
    // so a second click must not produce one.
    const { event } = await anOpenEvent({ capacity: 5 });
    const student = await loginAsStudent(app);

    const first = await register(student.sessionCookie, event.id);
    const second = await register(student.sessionCookie, event.id);

    expect(second.status).toBe(201);
    expect(second.body.id).toBe(first.body.id);
    expect(await prisma.eventRegistration.count({ where: { eventId: event.id } })).toBe(1);
    expect((await prisma.event.findUniqueOrThrow({ where: { id: event.id } })).confirmedCount).toBe(1);
  });
});

describe('GET /events/:eventId/registrations', () => {
  it('is open to the club Lead and to an assigned Operations officer, and closed to Marketing', async () => {
    const { club, lead, event } = await anOpenEvent({ capacity: 5 });
    const marketing = await makeActiveOfficer(app, club.id, 'MARKETING');
    const ops = await makeActiveOfficer(app, club.id, 'OPERATIONS');
    const student = await loginAsStudent(app);
    await register(student.sessionCookie, event.id);

    const roster = (cookie: string) =>
      request(app.getHttpServer())
        .get(`${API_PREFIX}/events/${event.id}/registrations`)
        .set('Cookie', cookie);

    expect((await roster(lead.sessionCookie)).status).toBe(200);

    // Marketing is excluded from attendee data outright, and Operations reach the
    // roster only for an assigned event: a standing appointment is not enough.
    const refusedMarketing = await roster(marketing.sessionCookie);
    expect(refusedMarketing.status).toBe(403);
    expect(refusedMarketing.body.detail).toBe('You do not have permission to do that.');
    expect((await roster(ops.sessionCookie)).status).toBe(403);

    await request(app.getHttpServer())
      .post(`${API_PREFIX}/events/${event.id}/assignments`)
      .set('Cookie', lead.sessionCookie)
      .send({ userId: ops.userId, responsibility: 'OPERATIONS' });

    const assigned = await roster(ops.sessionCookie);
    expect(assigned.status).toBe(200);
    expect(assigned.body.items[0].userEmail).toBeTruthy();
  });
});

describe('what a promotion leaves behind', () => {
  it('clears the waitlist position of the student it promoted', async () => {
    // A non-null position means "waitlisted" on three screens, so leaving it set
    // renders "Confirmed" and "Position 1" together.
    const { event } = await anOpenEvent({ capacity: 1, waitlistEnabled: true });
    const [holder, queued] = await students(2);

    await register(holder!.sessionCookie, event.id);
    expect((await register(queued!.sessionCookie, event.id)).body.waitlistPosition).toBe(1);
    expect((await cancel(holder!.sessionCookie, event.id)).status).toBe(204);

    const detail = await request(app.getHttpServer())
      .get(`${API_PREFIX}/events/${event.id}`)
      .set('Cookie', queued!.sessionCookie);
    expect(detail.body.viewerRegistrationStatus).toBe('CONFIRMED');
    expect(detail.body.viewerWaitlistPosition).toBeNull();

    const mine = await request(app.getHttpServer())
      .get(`${API_PREFIX}/me/registrations`)
      .set('Cookie', queued!.sessionCookie);
    expect(mine.body.items).toHaveLength(1);
    expect(mine.body.items[0].status).toBe('CONFIRMED');
    expect(mine.body.items[0].waitlistPosition).toBeNull();
  });

  it('promotes nobody into a cancelled event', async () => {
    // A cancelled event has no seats to free, so promoting here makes someone
    // CONFIRMED on an event that is not happening, and sends them a
    // "you're off the waitlist" message for it.
    const { lead, event } = await anOpenEvent({ capacity: 1, waitlistEnabled: true });
    const [holder, queued] = await students(2);

    await register(holder!.sessionCookie, event.id);
    await register(queued!.sessionCookie, event.id);

    const cancelled = await request(app.getHttpServer())
      .post(`${API_PREFIX}/events/${event.id}/cancel`)
      .set('Cookie', lead.sessionCookie)
      .send({ reason: 'Venue fell through.' });
    expect(cancelled.status).toBe(201);

    expect((await cancel(holder!.sessionCookie, event.id)).status).toBe(204);

    const rows = await prisma.eventRegistration.findMany({ where: { eventId: event.id } });
    const byUser = new Map(rows.map((r) => [r.userId, r]));
    expect(byUser.get(queued!.userId)?.status).toBe('WAITLISTED');
    expect(byUser.get(queued!.userId)?.promotedAt).toBeNull();
    // The seat still comes off the counter, which records who held one.
    expect((await prisma.event.findUniqueOrThrow({ where: { id: event.id } })).confirmedCount).toBe(0);
  });
});

describe('PATCH /events/:eventId capacity, against the confirmed count', () => {
  it('promotes only as many as the new headroom, not the whole new capacity', async () => {
    // Headroom is capacity - confirmedCount, not capacity: with one seat taken,
    // raising 3 to 4 has room for three more, and promoting four oversells.
    const { lead, event } = await anOpenEvent({ capacity: 3, waitlistEnabled: true, confirmedCount: 1 });
    const queued = await students(4);
    await prisma.eventRegistration.createMany({
      data: queued.map((s, i) => ({
        eventId: event.id,
        userId: s.userId,
        status: 'WAITLISTED' as const,
        waitlistPosition: i + 1,
      })),
    });

    const res = await request(app.getHttpServer())
      .patch(`${API_PREFIX}/events/${event.id}`)
      .set('Cookie', lead.sessionCookie)
      .send({ capacity: 4 });

    expect(res.status).toBe(200);
    const after = await prisma.event.findUniqueOrThrow({ where: { id: event.id } });
    expect(after.confirmedCount).toBe(4);
    expect(
      await prisma.eventRegistration.count({ where: { eventId: event.id, status: 'CONFIRMED' } }),
    ).toBe(3);
    expect(
      await prisma.eventRegistration.count({ where: { eventId: event.id, status: 'WAITLISTED' } }),
    ).toBe(1);
  });

  it('reads the confirmed count under the row lock, not before it', async () => {
    // Catches confirmedCount read outside the lock: a registration committing in
    // between passes the guard on a stale count, and the CHECK rejects the write
    // as a 23514, giving a generic conflict instead of the counted message.
    const { lead, event } = await anOpenEvent({ capacity: 3, waitlistEnabled: true, confirmedCount: 2 });
    const latecomer = await loginAsStudent(app);

    // The in-flight request must not be returned from the callback: Prisma awaits
    // the return value before committing, and the request waits on that commit.
    let inFlight!: Promise<request.Response>;
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM "event" WHERE "id" = ${event.id}::uuid FOR UPDATE`;
      inFlight = request(app.getHttpServer())
        .patch(`${API_PREFIX}/events/${event.id}`)
        .set('Cookie', lead.sessionCookie)
        .send({ capacity: 2 })
        .then((r) => r);
      await new Promise((resolve) => setTimeout(resolve, 300));
      await tx.eventRegistration.create({
        data: { eventId: event.id, userId: latecomer.userId, status: 'CONFIRMED' },
      });
      await tx.event.update({ where: { id: event.id }, data: { confirmedCount: { increment: 1 } } });
    });
    const res = await inFlight;

    expect(res.status).toBe(422);
    expect(res.body.detail).toBe('Capacity cannot be lower than the 3 students already confirmed.');
    expect((await prisma.event.findUniqueOrThrow({ where: { id: event.id } })).capacity).toBe(3);
  });
});

describe('GET /me/registrations?past=', () => {
  function mine(cookie: string, qs = '') {
    return request(app.getHttpServer())
      .get(`${API_PREFIX}/me/registrations${qs}`)
      .set('Cookie', cookie);
  }

  /** Three events the caller holds a CONFIRMED place at, spanning the boundary
   *  that matters: one that has started but not ended is still "upcoming". */
  async function threeRegistrations() {
    const club = await makeClub();
    const lead = await makeActiveLead(app, club.id);
    const student = await loginAsStudent(app);

    const past = await mkEvent(club.id, lead.userId, {
      startsAt: new Date(Date.now() - 3 * DAY),
      endsAt: new Date(Date.now() - 3 * DAY + 2 * HOUR),
      registrationOpensAt: new Date(Date.now() - 5 * DAY),
      registrationClosesAt: new Date(Date.now() - 3 * DAY),
    });
    const future = await mkEvent(club.id, lead.userId, {
      startsAt: new Date(Date.now() + 3 * DAY),
      endsAt: new Date(Date.now() + 3 * DAY + 2 * HOUR),
      registrationOpensAt: new Date(Date.now() - DAY),
      registrationClosesAt: new Date(Date.now() + 2 * DAY),
    });
    // Started but not ended: without this fixture, splitting on startsAt
    // would pass the same as splitting on endsAt.
    const ongoing = await mkEvent(club.id, lead.userId, {
      startsAt: new Date(Date.now() - HOUR),
      endsAt: new Date(Date.now() + 2 * HOUR),
      registrationOpensAt: new Date(Date.now() - DAY),
      registrationClosesAt: new Date(Date.now() - 30 * 60 * 1000),
    });

    for (const event of [past, future, ongoing]) {
      await mkRegistration(event.id, student.userId, 'CONFIRMED');
    }

    return { student, past, future, ongoing };
  }

  const idsOf = (res: request.Response): string[] =>
    (res.body.items as { event: { id: string } }[]).map((r) => r.event.id);

  it("splits on the event's end, not its start", async () => {
    // Without the ongoing event, an implementation splitting on startsAt
    // passes this test identically to one splitting on endsAt.
    const { student, past, future, ongoing } = await threeRegistrations();

    const upcoming = await mine(student.sessionCookie, '?past=false');
    expect(new Set(idsOf(upcoming))).toEqual(new Set([future.id, ongoing.id]));

    const ended = await mine(student.sessionCookie, '?past=true');
    expect(idsOf(ended)).toEqual([past.id]);
  });

  it('returns every registration when past is absent', async () => {
    // Guards /profile/registrations, which has never taken this flag: an
    // implementation defaulting past to false would drop the ended event here.
    const { student, past, future, ongoing } = await threeRegistrations();

    const res = await mine(student.sessionCookie);
    expect(new Set(idsOf(res))).toEqual(new Set([past.id, future.id, ongoing.id]));
  });
});

describe('the Admin override response', () => {
  it('carries the attendee, not the admin who registered them', async () => {
    // Catches person() short-circuiting to the actor for a self-registration:
    // an override registers somebody else, so the response names the admin.
    const email = `${uniq('attendee')}@uni.ac.ae`;
    const { event } = await anOpenEvent({ capacity: 5 });
    const attendee = await loginAsStudent(app, { email, fullName: 'Real Attendee' });
    const admin = await loginAsAdmin(app, { fullName: 'The Administrator' });

    const res = await register(admin.sessionCookie, event.id, {
      userId: attendee.userId,
      overrideReason: 'Invited speaker.',
    });

    expect(res.status).toBe(201);
    expect(res.body.userId).toBe(attendee.userId);
    expect(res.body.userFullName).toBe('Real Attendee');
    expect(res.body.userEmail).toBe(email);
  });
});
