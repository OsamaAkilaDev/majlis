import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { API_PREFIX } from '../src/config/api-prefix';
import { createTestApp } from './app';
import { loginAsAdmin, loginAsStudent, type LoggedInUser } from './auth-helpers';
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
    // Five genuinely simultaneous requests from five distinct users, not five
    // sequential calls: a sequential pair passes against a read-then-write
    // implementation with no row lock at all. Only real concurrency puts two
    // transactions inside the window between reading confirmed_count and
    // incrementing it.
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

    // The four losers form a queue with no duplicate places in it. A position
    // assigned outside the row lock produces two students at position 1 and a
    // promotion order nobody can defend.
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
    // The filter maps any stray P2002 to a generic 409 too, so the status
    // alone proves nothing about which branch ran.
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
    // Position 1, not position 2 and not both: promotion order is the whole
    // point of holding a queue rather than a set.
    expect(byUser.get(first!.userId)?.status).toBe('CONFIRMED');
    expect(byUser.get(first!.userId)?.promotedAt).not.toBeNull();
    expect(byUser.get(second!.userId)?.status).toBe('WAITLISTED');
    expect(byUser.get(holder!.userId)?.status).toBe('CANCELLED');

    // The counter has to come back to exactly one. Decrementing without
    // re-incrementing on promotion leaves the event permanently under-filled.
    expect((await prisma.event.findUniqueOrThrow({ where: { id: event.id } })).confirmedCount).toBe(1);
  });

  it('does not free a seat when a waitlisted student cancels', async () => {
    // Cancelling from the waitlist frees nothing. A handler that decremented
    // the counter for every cancellation would push the event over capacity
    // on the next registration.
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

    // Closed a second ago but not yet swept: the window check has to stand on
    // its own, not lean on the lifecycle having already moved the status.
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

    // 404, not 403: a draft is not visible outside the club team, so the
    // refusal must not confirm that it exists.
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

    // Spec 6.1: every Admin override records a reason, in the same
    // transaction as the action.
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
    // Spec 8 makes registration idempotent. 409 is reserved for the
    // full-and-no-waitlist case, so a second click must not produce one.
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

    // Spec 6.1 excludes Marketing from attendee personal data outright, and
    // gives club Operations the roster only for an event they are assigned
    // to — a standing club appointment is not enough.
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
