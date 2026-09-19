import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { API_PREFIX } from '../src/config/api-prefix';
import { RegistrationsService } from '../src/events/registrations.service';
import { StorageService } from '../src/storage/storage.service';
import { TransactionHost } from '../src/prisma/transaction.host';
import { createTestApp } from './app';
import { loginAsAdmin, loginAsStudent } from './auth-helpers';
import { createTestPrisma, disconnectTestPrisma, truncateAll } from './db';
import { makeActiveLead, makeClub, mkEvent, mkRegistration, mkUser } from './factories';

const prisma = createTestPrisma();
let app: INestApplication;

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
/** Matches ATTENDANCE_CORRECTION_WINDOW_HOURS' default. */
const WINDOW_HOURS = 48;

/** Certificates need storage; nothing here exercises it. */
const fakeStorage = {
  createSignedUploadUrl: async (path: string) => ({ signedUrl: `https://example.test/${path}`, token: 't' }),
  statObject: async () => ({ size: 1, contentType: 'application/pdf' }),
  putObject: async () => {},
  publicUrlFor: (path: string) => `https://example.test/${path}`,
  createSignedDownloadUrl: async (path: string) => `https://example.test/${path}`,
};

beforeAll(async () => {
  app = await createTestApp([], [{ provide: StorageService, useValue: fakeStorage }]);
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

function post(path: string, cookie: string, body: object = {}) {
  return request(app.getHttpServer()).post(`${API_PREFIX}${path}`).set('Cookie', cookie).send(body);
}

function patch(path: string, cookie: string, body: object) {
  return request(app.getHttpServer()).patch(`${API_PREFIX}${path}`).set('Cookie', cookie).send(body);
}

describe('a notification row is written in the same transaction as its trigger', () => {
  it('rolls the registration notification back with the registration that failed', async () => {
    // Catches a NotificationService escaping the ambient transaction, with its
    // own client or a write after host.run returns: it commits immediately and
    // tells a student they hold a seat the rollback destroyed.
    const host = app.get(TransactionHost);
    const registrations = app.get(RegistrationsService);
    const club = await makeClub();
    const lead = await makeActiveLead(app, club.id);
    const event = await mkEvent(club.id, lead.userId);
    const student = await mkUser();
    const actor = {
      id: student.id,
      platformRole: 'STUDENT' as const,
      fullName: student.fullName,
      email: student.email,
    };

    await expect(
      host.run(async () => {
        await registrations.register(actor, event.id, {});
        throw new Error('the action failed after the notification was written');
      }),
    ).rejects.toThrow('the action failed');

    // Both counts: the registration one proves the rollback happened, so a zero
    // notification count cannot mean the registration was never attempted.
    expect(await prisma.eventRegistration.count()).toBe(0);
    expect(await prisma.notification.count()).toBe(0);
  });

  it('writes the notification when the registration commits', async () => {
    const club = await makeClub();
    const lead = await makeActiveLead(app, club.id);
    const event = await mkEvent(club.id, lead.userId);
    const student = await loginAsStudent(app);

    await post(`/events/${event.id}/registrations`, student.sessionCookie).expect(201);

    const rows = await prisma.notification.findMany({ where: { userId: student.userId } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.type).toBe('registration.confirmed');
    expect(rows[0]?.emailStatus).toBe('PENDING');
    expect(rows[0]?.dedupeKey.startsWith('registration.confirmed:')).toBe(true);
  });

  it('records a waitlisted registration under its own type', async () => {
    const club = await makeClub();
    const lead = await makeActiveLead(app, club.id);
    const event = await mkEvent(club.id, lead.userId, { capacity: 1, confirmedCount: 1 });
    const student = await loginAsStudent(app);

    await post(`/events/${event.id}/registrations`, student.sessionCookie).expect(201);

    const row = await prisma.notification.findFirstOrThrow({ where: { userId: student.userId } });
    expect(row.type).toBe('registration.waitlisted');
  });
});

describe('the dedupe key absorbs a repeated trigger', () => {
  it('issues certificates twice and notifies the holder once', async () => {
    // Issuance is idempotent, so a second press re-reads every ACTIVE
    // certificate and tries to notify for all of them. Only the
    // (user_id, dedupe_key) index stops the holder hearing twice.
    const now = Date.now();
    const endedAt = now - (WINDOW_HOURS + 1) * HOUR;
    const club = await makeClub();
    const lead = await makeActiveLead(app, club.id);
    const admin = await loginAsAdmin(app);
    const event = await mkEvent(club.id, lead.userId, {
      status: 'COMPLETED',
      certificateEnabled: true,
      startsAt: new Date(endedAt - 2 * HOUR),
      endsAt: new Date(endedAt),
      registrationOpensAt: new Date(endedAt - 5 * DAY),
      registrationClosesAt: new Date(endedAt - HOUR),
    });
    const student = await mkUser();
    await mkRegistration(event.id, student.id, 'CHECKED_IN');

    await post(`/events/${event.id}/certificates/issue`, admin.sessionCookie).expect(200);
    await post(`/events/${event.id}/certificates/issue`, admin.sessionCookie).expect(200);

    const rows = await prisma.notification.findMany({
      where: { userId: student.id, type: 'certificate.issued' },
    });
    expect(rows).toHaveLength(1);
    expect(await prisma.certificate.count({ where: { eventId: event.id } })).toBe(1);
  });
});

describe('GET /me/notifications', () => {
  it('returns only the caller own rows', async () => {
    const mine = await loginAsStudent(app);
    const other = await mkUser();
    await prisma.notification.createMany({
      data: [
        { userId: mine.userId, type: 'event.published', dedupeKey: 'event.published:a', payload: {} },
        { userId: other.id, type: 'event.published', dedupeKey: 'event.published:b', payload: {} },
      ],
    });

    const res = await get('/me/notifications', mine.sessionCookie).expect(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].type).toBe('event.published');
  });

  it('lists newest first and continues across a page boundary', async () => {
    // The inbox reads backwards, so the cursor seek must too. Catches desc order
    // with an ascending seek: page two repeats or skips page one, and the unread
    // badge sticks on whatever the oldest ten say.
    const mine = await loginAsStudent(app);
    for (let i = 0; i < 5; i += 1) {
      await prisma.notification.create({
        data: { userId: mine.userId, type: 'event.published', dedupeKey: `k${i}`, payload: {} },
      });
    }
    // Read back rather than assumed from insertion order: the endpoint owes the
    // reverse of id order, whatever that order is.
    const newest = (
      await prisma.notification.findMany({ where: { userId: mine.userId }, orderBy: { id: 'desc' } })
    ).map((r) => r.id);

    const ids = (res: { body: { items: { id: string }[] } }) => res.body.items.map((i) => i.id);

    const one = await get('/me/notifications?limit=2', mine.sessionCookie).expect(200);
    expect(ids(one)).toEqual(newest.slice(0, 2));
    expect(one.body.nextCursor).toBe(newest[1]);

    const two = await get(
      `/me/notifications?limit=2&cursor=${one.body.nextCursor}`,
      mine.sessionCookie,
    ).expect(200);
    expect(ids(two)).toEqual(newest.slice(2, 4));

    const three = await get(
      `/me/notifications?limit=2&cursor=${two.body.nextCursor}`,
      mine.sessionCookie,
    ).expect(200);
    expect(ids(three)).toEqual(newest.slice(4));
    expect(three.body.nextCursor).toBeNull();
  });

  it('filters to unread rows with ?unread=true', async () => {
    const mine = await loginAsStudent(app);
    await prisma.notification.createMany({
      data: [
        { userId: mine.userId, type: 'event.published', dedupeKey: 'k1', payload: {}, readAt: new Date() },
        { userId: mine.userId, type: 'event.cancelled', dedupeKey: 'k2', payload: {} },
      ],
    });

    const res = await get('/me/notifications?unread=true', mine.sessionCookie).expect(200);
    expect(res.body.items.map((i: { type: string }) => i.type)).toEqual(['event.cancelled']);
  });

  it('never returns an auth.password_reset row, which records a request rather than inbox content', async () => {
    // The real payload is `{ expiresInMinutes }`. This fixture is deliberately
    // worse than anything the product writes, so the assertion fails on a filter
    // that leaks the row, not only on one that leaks a link.
    const mine = await loginAsStudent(app);
    await prisma.notification.create({
      data: {
        userId: mine.userId,
        type: 'auth.password_reset',
        dedupeKey: 'auth.password_reset:1',
        payload: { resetUrl: 'https://example.test/reset-password?token=LEAKED' },
      },
    });

    const res = await get('/me/notifications', mine.sessionCookie).expect(200);
    expect(res.body.items).toEqual([]);
    expect(JSON.stringify(res.body)).not.toContain('LEAKED');
  });
});

describe('POST /me/notifications/:id/read', () => {
  it('marks the caller own row read, idempotently', async () => {
    const mine = await loginAsStudent(app);
    const row = await prisma.notification.create({
      data: { userId: mine.userId, type: 'event.published', dedupeKey: 'k1', payload: {} },
    });

    const first = await post(`/me/notifications/${row.id}/read`, mine.sessionCookie).expect(200);
    expect(first.body.readAt).not.toBeNull();

    const second = await post(`/me/notifications/${row.id}/read`, mine.sessionCookie).expect(200);
    // The same instant, not a fresh one: a second press must not rewrite when
    // the notification was first read.
    expect(second.body.readAt).toBe(first.body.readAt);
  });

  it('refuses to mark another user notification read', async () => {
    const mine = await loginAsStudent(app);
    const other = await mkUser();
    const theirs = await prisma.notification.create({
      data: { userId: other.id, type: 'event.published', dedupeKey: 'k1', payload: {} },
    });

    const res = await post(`/me/notifications/${theirs.id}/read`, mine.sessionCookie).expect(404);
    expect(res.body.detail).toBe('No such notification.');
    expect(
      (await prisma.notification.findUniqueOrThrow({ where: { id: theirs.id } })).readAt,
    ).toBeNull();
  });
});

describe('a material event change', () => {
  async function anEventWithAnAttendee() {
    const club = await makeClub();
    const lead = await makeActiveLead(app, club.id);
    const event = await mkEvent(club.id, lead.userId, { onlineUrl: 'https://old.test/room' });
    const student = await mkUser();
    await mkRegistration(event.id, student.id, 'CONFIRMED');
    return { lead, event, student };
  }

  const MATERIAL: Record<string, unknown> = {
    // Each value must leave the merged row satisfying the window CHECKs: the
    // fixture runs +7d to +7d+2h, so startsAt moves earlier and endsAt later.
    startsAt: new Date(Date.now() + 6 * DAY).toISOString(),
    endsAt: new Date(Date.now() + 9 * DAY + 2 * HOUR).toISOString(),
    venue: 'Hall B',
    onlineUrl: 'https://new.test/room',
    timezone: 'Asia/Riyadh',
  };

  for (const [field, value] of Object.entries(MATERIAL)) {
    it(`notifies every attendee when ${field} changes`, async () => {
      const { lead, event, student } = await anEventWithAnAttendee();

      await patch(`/events/${event.id}`, lead.sessionCookie, { [field]: value }).expect(200);

      const rows = await prisma.notification.findMany({
        where: { userId: student.id, type: 'event.changed' },
      });
      expect(rows).toHaveLength(1);
      expect((rows[0]?.payload as { changed: string[] }).changed).toEqual([field]);
    });
  }

  it('notifies nobody when only the title changes', async () => {
    // A patch outside the notifying field set must be silent, or every copy edit
    // mails the attendee list.
    const { lead, event, student } = await anEventWithAnAttendee();

    await patch(`/events/${event.id}`, lead.sessionCookie, { title: 'A Better Name' }).expect(200);

    expect(
      await prisma.notification.count({ where: { userId: student.id, type: 'event.changed' } }),
    ).toBe(0);
  });

  it('notifies nobody when a material field is re-sent unchanged', async () => {
    const { lead, event, student } = await anEventWithAnAttendee();

    await patch(`/events/${event.id}`, lead.sessionCookie, { venue: event.venue }).expect(200);

    expect(
      await prisma.notification.count({ where: { userId: student.id, type: 'event.changed' } }),
    ).toBe(0);
  });

  it('does not notify a student who cancelled their registration', async () => {
    const club = await makeClub();
    const lead = await makeActiveLead(app, club.id);
    const event = await mkEvent(club.id, lead.userId);
    const gone = await mkUser();
    await mkRegistration(event.id, gone.id, 'CANCELLED');

    await patch(`/events/${event.id}`, lead.sessionCookie, { venue: 'Hall C' }).expect(200);

    expect(await prisma.notification.count({ where: { userId: gone.id } })).toBe(0);
  });
});
