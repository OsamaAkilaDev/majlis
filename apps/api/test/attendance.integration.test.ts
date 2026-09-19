import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { signPass } from '../src/attendance/qr-token';
import { API_PREFIX } from '../src/config/api-prefix';
import { createTestApp } from './app';
import { loginAsAdmin, loginAsStudent, type LoggedInUser } from './auth-helpers';
import { createTestPrisma, disconnectTestPrisma, truncateAll } from './db';
import { makeActiveLead, makeActiveOfficer, makeClub, mkEvent, mkRegistration } from './factories';

const prisma = createTestPrisma();
let app: INestApplication;

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

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

function scan(cookie: string, eventId: string, body: object) {
  return request(app.getHttpServer())
    .post(`${API_PREFIX}/events/${eventId}/check-in/scan`)
    .set('Cookie', cookie)
    .send(body);
}

function manual(cookie: string, eventId: string, body: object) {
  return request(app.getHttpServer())
    .post(`${API_PREFIX}/events/${eventId}/check-in/manual`)
    .set('Cookie', cookie)
    .send(body);
}

function roster(cookie: string, eventId: string) {
  return request(app.getHttpServer())
    .get(`${API_PREFIX}/events/${eventId}/attendance`)
    .set('Cookie', cookie);
}

function correct(cookie: string, eventId: string, registrationId: string, body: object) {
  return request(app.getHttpServer())
    .patch(`${API_PREFIX}/events/${eventId}/attendance/${registrationId}`)
    .set('Cookie', cookie)
    .send(body);
}

/** The token a student's own QR image carries, at whatever version is stored. */
async function passFor(student: LoggedInUser): Promise<string> {
  const res = await request(app.getHttpServer())
    .get(`${API_PREFIX}/me/qr-pass`)
    .set('Cookie', student.sessionCookie);
  return res.body.token as string;
}

/** An event running now, with a Lead, an Operations
 * officer, and one confirmed student holding a pass. */
async function anOngoingEvent(overrides: Record<string, unknown> = {}) {
  const now = Date.now();
  const club = await makeClub();
  const lead = await makeActiveLead(app, club.id);
  const ops = await makeActiveOfficer(app, club.id, 'OPERATIONS');
  const event = await mkEvent(club.id, lead.userId, {
    status: 'ONGOING',
    startsAt: new Date(now - HOUR),
    endsAt: new Date(now + HOUR),
    registrationOpensAt: new Date(now - DAY),
    registrationClosesAt: new Date(now - HOUR),
    capacity: 30,
    confirmedCount: 1,
    ...overrides,
  });
  const student = await loginAsStudent(app);
  const registration = await mkRegistration(event.id, student.userId, 'CONFIRMED');
  return { club, lead, ops, event, student, registration };
}

describe('POST /events/:eventId/check-in/scan', () => {
  it('checks a confirmed student in, once, with their name for the operator to eyeball', async () => {
    const { ops, event, student, registration } = await anOngoingEvent();

    const res = await scan(ops.sessionCookie, event.id, { token: await passFor(student) });

    expect(res.status).toBe(200);
    expect(res.body.result).toBe('CHECKED_IN');
    expect(res.body.email).toMatch(/@uni\.ac\.ae$/);
    expect(res.body.fullName).toBe('Test Person');

    const record = await prisma.attendanceRecord.findUniqueOrThrow({
      where: { registrationId: registration.id },
    });
    expect(record.method).toBe('QR_SCAN');
    expect(record.checkedInById).toBe(ops.userId);

    const after = await prisma.eventRegistration.findUniqueOrThrow({ where: { id: registration.id } });
    expect(after.status).toBe('CHECKED_IN');

    const audit = await prisma.auditLog.findMany({ where: { action: 'attendance.scanned' } });
    expect(audit).toHaveLength(1);
    expect(audit[0]?.actorUserId).toBe(ops.userId);
  });

  it('answers a second scan with the ORIGINAL time and writes no second record', async () => {
    const { ops, event, student, registration } = await anOngoingEvent();
    const token = await passFor(student);

    const first = await scan(ops.sessionCookie, event.id, { token });
    const second = await scan(ops.sessionCookie, event.id, { token });

    expect(second.body.result).toBe('ALREADY_CHECKED_IN');
    // Catches a rewritten timestamp, which answers "has this person already been
    // through the door" with the current clock instead of the record.
    expect(second.body.checkedInAt).toBe(first.body.checkedInAt);
    expect(await prisma.attendanceRecord.count({ where: { registrationId: registration.id } })).toBe(1);
  });

  it('admits one record when two operators scan the same person at the same instant', async () => {
    // Promise.all is not reliably concurrent here and passes even with
    // attendance_record_registration_id_key dropped, so the first operator is an
    // open transaction held here instead. The in-flight request must not be
    // returned from the callback: Prisma awaits the return value before
    // committing, and the request waits on that commit.
    const { ops, event, student, registration } = await anOngoingEvent();
    const token = await passFor(student);

    let inFlight!: Promise<request.Response>;
    await prisma.$transaction(async (tx) => {
      await tx.attendanceRecord.create({
        data: {
          registrationId: registration.id,
          eventId: event.id,
          userId: student.userId,
          checkedInById: ops.userId,
          method: 'QR_SCAN',
        },
      });
      inFlight = scan(ops.sessionCookie, event.id, { token }).then((r) => r);
      await new Promise((resolve) => setTimeout(resolve, 300));
    });
    const res = await inFlight;

    // Verified by dropping attendance_record_registration_id_key: the second
    // insert then succeeds and this is CHECKED_IN with two rows.
    expect(res.status).toBe(200);
    expect(res.body.result).toBe('ALREADY_CHECKED_IN');
    expect(await prisma.attendanceRecord.count({ where: { registrationId: registration.id } })).toBe(1);
  });

  it('refuses a pass whose version was rotated after the image was printed', async () => {
    const { ops, event, student } = await anOngoingEvent();
    const printed = await passFor(student);

    await request(app.getHttpServer())
      .post(`${API_PREFIX}/me/qr-pass/rotate`)
      .set('Cookie', student.sessionCookie);

    const res = await scan(ops.sessionCookie, event.id, { token: printed });

    expect(res.body).toEqual({ result: 'INVALID_PASS' });
    expect(await prisma.attendanceRecord.count({ where: { eventId: event.id } })).toBe(0);
  });

  it('refuses a pass signed with someone else’s key', async () => {
    const { ops, event, student } = await anOngoingEvent();
    await passFor(student);

    const forged = signPass(
      { userId: student.userId, tokenVersion: 1, issuedAt: new Date() },
      'z'.repeat(32),
    );

    expect((await scan(ops.sessionCookie, event.id, { token: forged })).body).toEqual({
      result: 'INVALID_PASS',
    });
  });

  it('names nobody when the holder is not registered for this event', async () => {
    // A failure must reveal nothing about an unrelated student.
    const { ops, event } = await anOngoingEvent();
    const stranger = await loginAsStudent(app);

    const res = await scan(ops.sessionCookie, event.id, { token: await passFor(stranger) });

    expect(res.body).toEqual({ result: 'NOT_REGISTERED' });
  });

  it('distinguishes a cancelled registration from never having registered', async () => {
    const { ops, event } = await anOngoingEvent();
    const quitter = await loginAsStudent(app);
    await mkRegistration(event.id, quitter.userId, 'CANCELLED');

    expect((await scan(ops.sessionCookie, event.id, { token: await passFor(quitter) })).body).toEqual({
      result: 'REGISTRATION_CANCELLED',
    });
  });

  it('refuses to check anyone in before the event has started', async () => {
    const now = Date.now();
    const { ops, event, student } = await anOngoingEvent({
      status: 'PUBLISHED',
      startsAt: new Date(now + 2 * DAY),
      endsAt: new Date(now + 2 * DAY + 2 * HOUR),
      registrationClosesAt: new Date(now + DAY),
    });

    const res = await scan(ops.sessionCookie, event.id, { token: await passFor(student) });

    expect(res.body.result).toBe('EVENT_NOT_OPEN');
    expect(res.body.eventStatus).toBe('PUBLISHED');
    expect(await prisma.attendanceRecord.count({ where: { eventId: event.id } })).toBe(0);
  });
});

describe('POST /events/:eventId/check-in/manual', () => {
  it('records the fallback check-in with its method and its reason', async () => {
    const { ops, event, student, registration } = await anOngoingEvent();
    const user = await prisma.user.findUniqueOrThrow({ where: { id: student.userId } });

    const res = await manual(ops.sessionCookie, event.id, {
      email: user.email.toUpperCase(),
      reason: 'Phone battery died at the door',
    });

    expect(res.body.result).toBe('CHECKED_IN');
    const record = await prisma.attendanceRecord.findUniqueOrThrow({
      where: { registrationId: registration.id },
    });
    expect(record.method).toBe('MANUAL');
    expect(record.manualReason).toBe('Phone battery died at the door');

    const audit = await prisma.auditLog.findMany({ where: { action: 'attendance.manual_check_in' } });
    expect(audit[0]?.reason).toBe('Phone battery died at the door');
  });

  it('answers an address with no account exactly like one with no registration', async () => {
    // Catches divergent answers, which make the check-in screen an oracle for
    // who holds a Majlis account.
    const { ops, event } = await anOngoingEvent();

    const res = await manual(ops.sessionCookie, event.id, {
      email: 'nobody-at-all@uni.ac.ae',
      reason: 'Camera failed',
    });

    expect(res.body).toEqual({ result: 'NOT_REGISTERED' });
  });

  it('gives a closed event the same answer whether or not the address has an account', async () => {
    // The test above covers only the OPEN event, the one state where both answers
    // agreed anyway. Catches resolving the address before checking the window:
    // unknown short-circuits to NOT_REGISTERED while known reaches EVENT_NOT_OPEN,
    // and an event is closed for almost all of its life.
    const now = Date.now();
    const { ops, event, student } = await anOngoingEvent({
      status: 'PUBLISHED',
      startsAt: new Date(now + 2 * DAY),
      endsAt: new Date(now + 2 * DAY + HOUR),
      registrationClosesAt: new Date(now + DAY),
    });
    const registered = await prisma.user.findUniqueOrThrow({ where: { id: student.userId } });

    const known = await manual(ops.sessionCookie, event.id, {
      email: registered.email,
      reason: 'Camera failed',
    });
    const unknown = await manual(ops.sessionCookie, event.id, {
      email: 'nobody-at-all@uni.ac.ae',
      reason: 'Camera failed',
    });

    expect(known.body).toEqual(unknown.body);
    expect(known.body.result).toBe('EVENT_NOT_OPEN');
  });

  it('does not distinguish a suspended account from one that does not exist', async () => {
    // The same oracle one layer down: a suspended holder answering INVALID_PASS
    // and an unknown address NOT_REGISTERED separates the two.
    const { ops, event } = await anOngoingEvent();
    const suspended = await loginAsStudent(app);
    await mkRegistration(event.id, suspended.userId, 'CONFIRMED');
    await prisma.user.update({ where: { id: suspended.userId }, data: { status: 'SUSPENDED' } });
    const row = await prisma.user.findUniqueOrThrow({ where: { id: suspended.userId } });

    const known = await manual(ops.sessionCookie, event.id, {
      email: row.email,
      reason: 'Camera failed',
    });
    const unknown = await manual(ops.sessionCookie, event.id, {
      email: 'nobody-at-all@uni.ac.ae',
      reason: 'Camera failed',
    });

    expect(known.body).toEqual(unknown.body);
    expect(known.body).toEqual({ result: 'NOT_REGISTERED' });
  });
});

describe('who may scan', () => {
  it('lets an EventAssignment holder with no club role scan', async () => {
    // EventAssignment's whole point: scan rights for one event without a
    // standing club role. Catches a guard reading club roles only.
    const { lead, event, student } = await anOngoingEvent();
    const helper = await loginAsStudent(app);
    await prisma.eventAssignment.create({
      data: { eventId: event.id, userId: helper.userId, responsibility: 'OPERATIONS', assignedById: lead.userId },
    });

    const res = await scan(helper.sessionCookie, event.id, { token: await passFor(student) });

    expect(res.status).toBe(200);
    expect(res.body.result).toBe('CHECKED_IN');
  });

  it('refuses a club Marketing officer, who is not on spec 6.1’s scan row', async () => {
    const { club, event, student } = await anOngoingEvent();
    const marketing = await makeActiveOfficer(app, club.id, 'MARKETING');

    const res = await scan(marketing.sessionCookie, event.id, { token: await passFor(student) });

    expect(res.status).toBe(403);
    expect(res.body.detail).toBe('You do not have permission to do that.');
    expect(await prisma.attendanceRecord.count({ where: { eventId: event.id } })).toBe(0);

    const denied = await prisma.auditLog.findMany({ where: { outcome: 'DENIED' } });
    expect(denied[0]?.reason).toBe('attendance:scan');
  });
});

describe('GET /events/:eventId/attendance', () => {
  it('counts what is checked in against what was expected', async () => {
    // Read with the Lead's cookie, not Operations': club Operations reach
    // attendee data only through an EventAssignment, not a standing club role.
    const { lead, ops, event, student } = await anOngoingEvent();
    const waiting = await loginAsStudent(app);
    await mkRegistration(event.id, waiting.userId, 'WAITLISTED', { waitlistPosition: 1 });
    await scan(ops.sessionCookie, event.id, { token: await passFor(student) });

    const res = await roster(lead.sessionCookie, event.id);

    expect(res.status).toBe(200);
    expect(res.body.checkedIn).toBe(1);
    // A waitlisted student was never expected, so the denominator is one.
    expect(res.body.expected).toBe(1);
    expect(res.body.items).toHaveLength(2);
    const checked = res.body.items.find((r: { userId: string }) => r.userId === student.userId);
    expect(checked.registrationStatus).toBe('CHECKED_IN');
    expect(checked.method).toBe('QR_SCAN');
  });
});

describe('PATCH /events/:eventId/attendance/:registrationId', () => {
  /** An event that ended `hoursAgo` hours ago, with one checked-in student. */
  async function aFinishedEvent(hoursAgo: number) {
    const now = Date.now();
    const club = await makeClub();
    const lead = await makeActiveLead(app, club.id);
    const ops = await makeActiveOfficer(app, club.id, 'OPERATIONS');
    const event = await mkEvent(club.id, lead.userId, {
      status: 'COMPLETED',
      startsAt: new Date(now - (hoursAgo + 2) * HOUR),
      endsAt: new Date(now - hoursAgo * HOUR),
      registrationOpensAt: new Date(now - 30 * DAY),
      registrationClosesAt: new Date(now - (hoursAgo + 3) * HOUR),
      capacity: 30,
      confirmedCount: 1,
    });
    const student = await loginAsStudent(app);
    const registration = await mkRegistration(event.id, student.userId, 'CHECKED_IN');
    await prisma.attendanceRecord.create({
      data: {
        registrationId: registration.id,
        eventId: event.id,
        userId: student.userId,
        checkedInById: ops.userId,
        method: 'QR_SCAN',
      },
    });
    return { club, lead, ops, event, student, registration };
  }

  it('lets Operations correct inside the window', async () => {
    const { ops, event, registration } = await aFinishedEvent(1);

    const res = await correct(ops.sessionCookie, event.id, registration.id, {
      present: false,
      reason: 'Scanned the wrong badge',
    });

    expect(res.status).toBe(204);
    expect(await prisma.attendanceRecord.count({ where: { registrationId: registration.id } })).toBe(0);
    const after = await prisma.eventRegistration.findUniqueOrThrow({ where: { id: registration.id } });
    expect(after.status).toBe('NO_SHOW');

    const audit = await prisma.auditLog.findMany({ where: { action: 'attendance.corrected' } });
    expect(audit[0]?.before).toMatchObject({ status: 'CHECKED_IN' });
    expect(audit[0]?.after).toMatchObject({ status: 'NO_SHOW', present: false });
  });

  it('refuses Operations once the window has closed', async () => {
    // One hour past the 48-hour boundary, so this tests the boundary itself.
    const { ops, event, registration } = await aFinishedEvent(49);

    const res = await correct(ops.sessionCookie, event.id, registration.id, {
      present: false,
      reason: 'Too late',
    });

    expect(res.status).toBe(422);
    expect(res.body.detail).toBe('The window for correcting attendance on that event has closed.');
    expect(await prisma.attendanceRecord.count({ where: { registrationId: registration.id } })).toBe(1);
  });

  it('lets an Admin cross the closed window with a recorded override reason', async () => {
    const { event, registration } = await aFinishedEvent(49);
    const admin = await loginAsAdmin(app);

    const refused = await correct(admin.sessionCookie, event.id, registration.id, {
      present: false,
      reason: 'Registrar review',
    });
    // An override with no reason is indistinguishable from a bug in the audit
    // log, so it is refused even for an Admin.
    expect(refused.status).toBe(422);
    expect(refused.body.detail).toBe(
      'Correcting attendance after the window has closed requires an override reason.',
    );

    const res = await correct(admin.sessionCookie, event.id, registration.id, {
      present: false,
      reason: 'Registrar review',
      override: { reason: 'Dean requested a correction on appeal' },
    });

    expect(res.status).toBe(204);
    const audit = await prisma.auditLog.findMany({ where: { action: 'attendance.corrected' } });
    expect(audit[0]?.before).toMatchObject({ override: 'Dean requested a correction on appeal' });
  });

  it('corrects a NO_SHOW back to present, which is a status it may rewrite', async () => {
    // The allowed half of the status guard below: NO_SHOW is the row an officer
    // reaches for after the event, so a CONFIRMED/CHECKED_IN-only guard breaks
    // the ordinary correction.
    const { ops, event, registration } = await aFinishedEvent(1);
    await prisma.attendanceRecord.delete({ where: { registrationId: registration.id } });
    await prisma.eventRegistration.update({ where: { id: registration.id }, data: { status: 'NO_SHOW' } });

    const res = await correct(ops.sessionCookie, event.id, registration.id, {
      present: true,
      reason: 'Signed the paper sheet at the door',
    });

    expect(res.status).toBe(204);
    const after = await prisma.eventRegistration.findUniqueOrThrow({ where: { id: registration.id } });
    expect(after.status).toBe('CHECKED_IN');
    expect(await prisma.attendanceRecord.count({ where: { registrationId: registration.id } })).toBe(1);
  });

  it('refuses to correct a cancelled registration, rather than resurrecting it', async () => {
    // Without the status guard this writes CHECKED_IN over a withdrawal, making
    // a student who pulled out certificate-eligible, or trips
    // event_registration_one_open_per_user if they registered again.
    const { ops, event, student, registration } = await aFinishedEvent(1);
    await prisma.attendanceRecord.delete({ where: { registrationId: registration.id } });
    await prisma.eventRegistration.update({
      where: { id: registration.id },
      data: { status: 'CANCELLED' },
    });

    const res = await correct(ops.sessionCookie, event.id, registration.id, {
      present: true,
      reason: 'Thought they were here',
    });

    expect(res.status).toBe(422);
    expect(res.body.detail).toBe(
      'That student cancelled their registration, so there is no attendance to correct.',
    );
    const after = await prisma.eventRegistration.findUniqueOrThrow({ where: { id: registration.id } });
    expect(after.status).toBe('CANCELLED');
    expect(await prisma.attendanceRecord.count({ where: { userId: student.userId } })).toBe(0);
  });

  it('refuses to correct a waitlisted registration, which never held a seat', async () => {
    // CHECKED_IN here would not increment Event.confirmedCount, diverging the
    // counter the `capacity >= confirmed_count` CHECK guards.
    const { ops, event, registration } = await aFinishedEvent(1);
    await prisma.attendanceRecord.delete({ where: { registrationId: registration.id } });
    await prisma.eventRegistration.update({
      where: { id: registration.id },
      data: { status: 'WAITLISTED', waitlistPosition: 1 },
    });
    const before = await prisma.event.findUniqueOrThrow({ where: { id: event.id } });

    const res = await correct(ops.sessionCookie, event.id, registration.id, {
      present: true,
      reason: 'Let them in on the night',
    });

    expect(res.status).toBe(422);
    expect(res.body.detail).toBe(
      'That student was on the waiting list and never held a place at the event.',
    );
    const after = await prisma.eventRegistration.findUniqueOrThrow({ where: { id: registration.id } });
    expect(after.status).toBe('WAITLISTED');
    expect((await prisma.event.findUniqueOrThrow({ where: { id: event.id } })).confirmedCount).toBe(
      before.confirmedCount,
    );
  });

  it('refuses a registration that belongs to a different event', async () => {
    // Catches a lookup by row id alone: an officer of one event could then
    // rewrite another event's attendance.
    const { ops, event } = await aFinishedEvent(1);
    const other = await aFinishedEvent(1);

    const res = await correct(ops.sessionCookie, event.id, other.registration.id, {
      present: false,
      reason: 'Wrong event entirely',
    });

    expect(res.status).toBe(404);
    expect(res.body.detail).toBe('No such registration for that event.');
    expect(
      await prisma.attendanceRecord.count({ where: { registrationId: other.registration.id } }),
    ).toBe(1);
  });
});

describe('the roster after an event completes', () => {
  it('turns everyone who never scanned into a NO_SHOW, in the same transaction as the hop', async () => {
    const now = Date.now();
    const club = await makeClub();
    const lead = await makeActiveLead(app, club.id);
    const ops = await makeActiveOfficer(app, club.id, 'OPERATIONS');
    // Stored ONGOING but already over: the next read advances it.
    const event = await mkEvent(club.id, lead.userId, {
      status: 'ONGOING',
      startsAt: new Date(now - 4 * HOUR),
      endsAt: new Date(now - 2 * HOUR),
      registrationOpensAt: new Date(now - 30 * DAY),
      registrationClosesAt: new Date(now - 5 * HOUR),
      capacity: 1,
      confirmedCount: 1,
    });
    const attended = await loginAsStudent(app);
    const absent = await loginAsStudent(app);
    const waiting = await loginAsStudent(app);
    const gone = await loginAsStudent(app);
    const attendedReg = await mkRegistration(event.id, attended.userId, 'CHECKED_IN');
    const absentReg = await mkRegistration(event.id, absent.userId, 'CONFIRMED');
    const waitingReg = await mkRegistration(event.id, waiting.userId, 'WAITLISTED', { waitlistPosition: 1 });
    const goneReg = await mkRegistration(event.id, gone.userId, 'CANCELLED');

    await request(app.getHttpServer())
      .get(`${API_PREFIX}/events/${event.id}`)
      .set('Cookie', ops.sessionCookie);

    const byId = new Map(
      (await prisma.eventRegistration.findMany({ where: { eventId: event.id } })).map((r) => [r.id, r.status]),
    );
    expect((await prisma.event.findUniqueOrThrow({ where: { id: event.id } })).status).toBe('COMPLETED');
    expect(byId.get(absentReg.id)).toBe('NO_SHOW');
    // A waitlisted student never held a seat, so they cannot be a no-show, and
    // sweeping them into NO_SHOW inflates the roster's `expected` denominator.
    expect(byId.get(waitingReg.id)).toBe('WAITLISTED');
    // Attendance and a withdrawal are both records of something that happened.
    expect(byId.get(attendedReg.id)).toBe('CHECKED_IN');
    expect(byId.get(goneReg.id)).toBe('CANCELLED');
  });

  it('still counts only the seats that were held, after the hop to COMPLETED', async () => {
    // The counter test above reads while ONGOING, before the transition that
    // breaks this: waitlisted rows swept into NO_SHOW report 1 / 1 all evening
    // and 1 / 2 the moment the event completes.
    const now = Date.now();
    const club = await makeClub();
    const lead = await makeActiveLead(app, club.id);
    const event = await mkEvent(club.id, lead.userId, {
      status: 'ONGOING',
      startsAt: new Date(now - 4 * HOUR),
      endsAt: new Date(now - 2 * HOUR),
      registrationOpensAt: new Date(now - 30 * DAY),
      registrationClosesAt: new Date(now - 5 * HOUR),
      capacity: 1,
      confirmedCount: 1,
    });
    const attended = await loginAsStudent(app);
    const waiting = await loginAsStudent(app);
    await mkRegistration(event.id, attended.userId, 'CHECKED_IN');
    await mkRegistration(event.id, waiting.userId, 'WAITLISTED', { waitlistPosition: 1 });

    // The roster route does not advance the event, reading the event does, which
    // is the order EventEditor loads them in.
    await request(app.getHttpServer())
      .get(`${API_PREFIX}/events/${event.id}`)
      .set('Cookie', lead.sessionCookie);
    const res = await roster(lead.sessionCookie, event.id);

    expect(res.status).toBe(200);
    expect((await prisma.event.findUniqueOrThrow({ where: { id: event.id } })).status).toBe('COMPLETED');
    expect(res.body.expected).toBe(1);
  });
});
