import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { API_PREFIX } from '../src/config/api-prefix';
import { EXAMPLE_NOTIFICATION_SWEEP_SECRET } from '../src/config/env.schema';
import { NOTIFICATION_SWEEP_SECRET_HEADER, SWEEP_SECRET_HEADER } from '../src/config/sweep-header';
import {
  NOTIFICATION_CHANNEL,
  SkippingChannel,
  type DeliverableNotification,
  type DeliveryOutcome,
} from '../src/notifications/notification-channel';
import { createTestApp } from './app';
import { loginAsStudent } from './auth-helpers';
import { createTestPrisma, disconnectTestPrisma, truncateAll } from './db';
import { makeActiveLead, makeClub, mkEvent, mkUser } from './factories';

const prisma = createTestPrisma();

/** The real wiring, with no RESEND_API_KEY set. */
let app: INestApplication;
/** The same app with the channel replaced, so failure is reachable. */
let appWithChannel: INestApplication;

/** Addresses this fake refuses, and how. Set per test. */
const rejects = new Map<string, 'throw' | 'error'>();
/** Every address the fake was actually asked to deliver to, in order. */
const attempted: string[] = [];

const fakeChannel = {
  async deliver(n: DeliverableNotification): Promise<DeliveryOutcome> {
    attempted.push(n.recipientEmail);
    const mode = rejects.get(n.recipientEmail);
    if (mode === 'throw') throw new Error('the mail host hung up');
    if (mode === 'error') return { status: 'FAILED', error: 'that address does not exist' };
    return { status: 'SENT' };
  },
};

beforeAll(async () => {
  app = await createTestApp();
  appWithChannel = await createTestApp([], [{ provide: NOTIFICATION_CHANNEL, useValue: fakeChannel }]);
});

afterAll(async () => {
  await app.close();
  await appWithChannel.close();
  await disconnectTestPrisma(prisma);
});

beforeEach(async () => {
  rejects.clear();
  attempted.length = 0;
  await truncateAll(prisma);
});

function sweep(target: INestApplication, secret?: string) {
  const req = request(target.getHttpServer()).post(`${API_PREFIX}/internal/notification-sweep`);
  return secret === undefined ? req : req.set(NOTIFICATION_SWEEP_SECRET_HEADER, secret);
}

/** A PENDING notification for a fresh user, whose address is returned. */
async function pending(type = 'registration.confirmed'): Promise<string> {
  const user = await mkUser();
  await prisma.notification.create({
    data: { userId: user.id, type, dedupeKey: `${type}:${user.id}`, payload: { eventTitle: 'A Thing' } },
  });
  return user.email;
}

describe('POST /internal/notification-sweep, authentication', () => {
  it('refuses a call with no secret at all', async () => {
    const res = await sweep(app).expect(401);
    expect(res.body.detail).toBe('That sweep secret is not valid.');
  });

  it('refuses a wrong secret', async () => {
    const res = await sweep(app, 'not-the-secret-at-all').expect(401);
    expect(res.body.detail).toBe('That sweep secret is not valid.');
  });

  it('refuses the lifecycle sweep secret presented in the notification header', async () => {
    // The two sweeps carry separate secrets deliberately, so one leaked
    // scheduler credential does not authorise the other endpoint. A shared
    // secret would make this call succeed.
    const res = await request(app.getHttpServer())
      .post(`${API_PREFIX}/internal/notification-sweep`)
      .set(NOTIFICATION_SWEEP_SECRET_HEADER, 'dev-only-lifecycle-sweep-secret')
      .expect(401);
    expect(res.body.detail).toBe('That sweep secret is not valid.');
  });

  it('refuses the right secret carried in the lifecycle sweep header', async () => {
    const res = await request(app.getHttpServer())
      .post(`${API_PREFIX}/internal/notification-sweep`)
      .set(SWEEP_SECRET_HEADER, EXAMPLE_NOTIFICATION_SWEEP_SECRET)
      .expect(401);
    expect(res.body.detail).toBe('That sweep secret is not valid.');
  });

  it('leaves every row PENDING when the call is refused', async () => {
    await pending();
    await sweep(app, 'not-the-secret-at-all').expect(401);
    expect(await prisma.notification.count({ where: { emailStatus: 'PENDING' } })).toBe(1);
  });
});

describe('with no RESEND_API_KEY configured', () => {
  it('resolves the skipping channel', async () => {
    // The whole of "Resend ships unwired" rests on this branch of the
    // factory. A default value on RESEND_API_KEY would construct a real
    // ResendChannel here and every row would land FAILED instead.
    expect(app.get(NOTIFICATION_CHANNEL)).toBeInstanceOf(SkippingChannel);
  });

  it('marks every pending row SKIPPED with no error, and sends nothing', async () => {
    await pending();
    await pending('event.published');

    const res = await sweep(app, EXAMPLE_NOTIFICATION_SWEEP_SECRET).expect(200);
    expect(res.body).toEqual({ sent: 0, failed: 0, skipped: 2 });

    const rows = await prisma.notification.findMany();
    expect(rows.map((r) => r.emailStatus)).toEqual(['SKIPPED', 'SKIPPED']);
    expect(rows.every((r) => r.emailError === null)).toBe(true);
  });
});

describe('delivery', () => {
  it('delivers the batch and records who was sent to', async () => {
    const a = await pending();
    const b = await pending('event.cancelled');

    const res = await sweep(appWithChannel, EXAMPLE_NOTIFICATION_SWEEP_SECRET).expect(200);

    expect(res.body).toEqual({ sent: 2, failed: 0, skipped: 0 });
    expect(attempted.sort()).toEqual([a, b].sort());
    expect(await prisma.notification.count({ where: { emailStatus: 'SENT' } })).toBe(2);
  });

  it('marks a refused address FAILED with the error and still delivers the rest', async () => {
    const bad = await pending();
    const good = await pending('event.published');
    rejects.set(bad, 'error');

    const res = await sweep(appWithChannel, EXAMPLE_NOTIFICATION_SWEEP_SECRET).expect(200);

    expect(res.body).toEqual({ sent: 1, failed: 1, skipped: 0 });
    const failed = await prisma.notification.findFirstOrThrow({ where: { emailStatus: 'FAILED' } });
    expect(failed.emailError).toBe('that address does not exist');
    expect(attempted).toContain(good);
    expect(
      (await prisma.notification.findFirstOrThrow({ where: { emailStatus: 'SENT' } })).emailError,
    ).toBeNull();
  });

  it('survives a channel that throws rather than returning a failure', async () => {
    // A network error, a bad JSON body, an SDK bug. One of them must not
    // take the rest of the batch down with it.
    const bad = await pending();
    const good = await pending('event.published');
    rejects.set(bad, 'throw');

    const res = await sweep(appWithChannel, EXAMPLE_NOTIFICATION_SWEEP_SECRET).expect(200);

    expect(res.body).toEqual({ sent: 1, failed: 1, skipped: 0 });
    const failed = await prisma.notification.findFirstOrThrow({ where: { emailStatus: 'FAILED' } });
    expect(failed.emailError).toBe('the mail host hung up');
    expect(attempted).toContain(good);
  });

  it('picks up PENDING rows only, so a FAILED row is never retried', async () => {
    const user = await mkUser();
    await prisma.notification.createMany({
      data: [
        {
          userId: user.id,
          type: 'event.published',
          dedupeKey: 'k-failed',
          payload: {},
          emailStatus: 'FAILED',
          emailError: 'that address does not exist',
        },
        { userId: user.id, type: 'event.cancelled', dedupeKey: 'k-sent', payload: {}, emailStatus: 'SENT' },
        {
          userId: user.id,
          type: 'registration.confirmed',
          dedupeKey: 'k-skipped',
          payload: {},
          emailStatus: 'SKIPPED',
        },
      ],
    });

    const res = await sweep(appWithChannel, EXAMPLE_NOTIFICATION_SWEEP_SECRET).expect(200);

    expect(res.body).toEqual({ sent: 0, failed: 0, skipped: 0 });
    expect(attempted).toEqual([]);
    // And the FAILED row keeps the reason it failed for.
    const failed = await prisma.notification.findFirstOrThrow({ where: { dedupeKey: 'k-failed' } });
    expect(failed.emailError).toBe('that address does not exist');
  });

  it('delivers a notification a real trigger wrote, end to end', async () => {
    // The one test here whose row the product wrote rather than this file:
    // a registration through the real route, swept through the real
    // endpoint. It is what catches a trigger that writes a row the sweep
    // cannot resolve a recipient for, or writes it already delivered.
    const club = await makeClub();
    const lead = await makeActiveLead(appWithChannel, club.id);
    const event = await mkEvent(club.id, lead.userId);
    const student = await loginAsStudent(appWithChannel);

    await request(appWithChannel.getHttpServer())
      .post(`${API_PREFIX}/events/${event.id}/registrations`)
      .set('Cookie', student.sessionCookie)
      .send({})
      .expect(201);

    const row = await prisma.notification.findFirstOrThrow({ where: { userId: student.userId } });
    expect(row.type).toBe('registration.confirmed');
    expect(row.emailStatus).toBe('PENDING');

    await sweep(appWithChannel, EXAMPLE_NOTIFICATION_SWEEP_SECRET).expect(200);

    const user = await prisma.user.findUniqueOrThrow({ where: { id: student.userId } });
    expect(attempted).toEqual([user.email]);
    expect(
      (await prisma.notification.findUniqueOrThrow({ where: { id: row.id } })).emailStatus,
    ).toBe('SENT');
  });
});
