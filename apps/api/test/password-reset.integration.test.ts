import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { RESET_LINK_INVALID, SESSION_EXPIRED } from '../src/auth/auth.service';
import { TokensService } from '../src/auth/tokens.service';
import { API_PREFIX } from '../src/config/api-prefix';
import {
  NOTIFICATION_CHANNEL,
  type DeliverableNotification,
  type DeliveryOutcome,
} from '../src/notifications/notification-channel';
import { createTestApp } from './app';
import { refresh, refreshCookieOf, signup, signupAndKeepCookies, suspendAsAdmin } from './auth-helpers';
import { createTestPrisma, disconnectTestPrisma, truncateAll } from './db';
import { uniq } from './factories';

const prisma = createTestPrisma();
let app: INestApplication;

const PASSWORD = 'correct-horse-battery';
const NEW_PASSWORD = 'a-completely-different-one';

/** Everything handed to the channel, in order. The raw reset token is persisted
 * nowhere, so this is the only place a test can get one. */
const delivered: DeliverableNotification[] = [];

const capturingChannel = {
  async deliver(notification: DeliverableNotification): Promise<DeliveryOutcome> {
    delivered.push(notification);
    return { status: 'SENT' };
  },
};

beforeAll(async () => {
  app = await createTestApp([], [{ provide: NOTIFICATION_CHANNEL, useValue: capturingChannel }]);
});

afterAll(async () => {
  await app.close();
  await disconnectTestPrisma(prisma);
});

beforeEach(async () => {
  delivered.length = 0;
  await truncateAll(prisma);
});

function forgot(email: string) {
  return request(app.getHttpServer()).post(`${API_PREFIX}/auth/forgot-password`).send({ email });
}

function reset(token: string, password = NEW_PASSWORD) {
  return request(app.getHttpServer())
    .post(`${API_PREFIX}/auth/reset-password`)
    .send({ token, password });
}

function preview(token: string) {
  return request(app.getHttpServer()).get(`${API_PREFIX}/auth/reset-password`).query({ token });
}

function login(email: string, password: string) {
  return request(app.getHttpServer()).post(`${API_PREFIX}/auth/login`).send({ email, password });
}

/** The raw token out of what was handed to the channel: stands in for reading
 * the email. */
function tokenFromEmail(): string {
  const last = delivered.at(-1)!;
  expect(last.type).toBe('auth.password_reset');
  const { resetUrl } = last.payload as { resetUrl: string };
  return new URL(resetUrl).searchParams.get('token')!;
}

describe('POST /auth/forgot-password', () => {
  it('answers 202 identically for a real address and an unknown one', async () => {
    // Any difference in status or body is an account-existence oracle open to an
    // unauthenticated caller.
    const email = `${uniq('reset')}@uni.ac.ae`;
    await signup(app, { email, password: PASSWORD }).expect(201);

    const real = await forgot(email);
    const unknown = await forgot(`${uniq('nobody')}@uni.ac.ae`);

    expect(real.status).toBe(202);
    expect(unknown.status).toBe(202);
    expect(real.body).toEqual(unknown.body);
    expect(real.text).toEqual(unknown.text);
  });

  it('writes a row for a real address and none for an unknown one', async () => {
    // The mirror of the test above: identical answers must not come from doing
    // nothing at all.
    const email = `${uniq('reset')}@uni.ac.ae`;
    const res = await signup(app, { email, password: PASSWORD }).expect(201);
    const userId = (res.body as { id: string }).id;

    await forgot(email).expect(202);
    await forgot(`${uniq('nobody')}@uni.ac.ae`).expect(202);

    expect(await prisma.passwordResetToken.count()).toBe(1);
    expect(await prisma.passwordResetToken.count({ where: { userId } })).toBe(1);
  });

  it('stores only the sha256 of the token, never the raw value', async () => {
    const email = `${uniq('reset')}@uni.ac.ae`;
    const res = await signup(app, { email, password: PASSWORD }).expect(201);
    const userId = (res.body as { id: string }).id;

    await forgot(email).expect(202);
    const raw = tokenFromEmail();
    const row = await prisma.passwordResetToken.findFirstOrThrow({ where: { userId } });

    expect(row.tokenHash).not.toBe(raw);
    expect(row.tokenHash).toBe(app.get(TokensService).hashOpaqueToken(raw));
    expect(JSON.stringify(row)).not.toContain(raw);
  });

  it('issues nothing for a suspended account', async () => {
    const email = `${uniq('reset')}@uni.ac.ae`;
    const res = await signup(app, { email, password: PASSWORD }).expect(201);
    await suspendAsAdmin(app, (res.body as { id: string }).id, 'testing');

    await forgot(email).expect(202);

    expect(await prisma.passwordResetToken.count()).toBe(0);
  });
});

describe('GET /auth/reset-password', () => {
  async function requestReset() {
    const email = `${uniq('reset')}@uni.ac.ae`;
    const res = await signup(app, { email, password: PASSWORD }).expect(201);
    await forgot(email).expect(202);
    return { email, userId: (res.body as { id: string }).id };
  }

  it('names the account a live link belongs to', async () => {
    const { email } = await requestReset();

    const res = await preview(tokenFromEmail()).expect(200);

    expect(res.body).toEqual({ email });
  });

  it('does not consume the link, so the reset still works afterwards', async () => {
    // Catches a preview that spends the token like the POST does: the screen
    // calls it on every page load, so every reset would then fail on submit,
    // and the test above would still pass.
    const { email } = await requestReset();
    const token = tokenFromEmail();

    await preview(token).expect(200);
    await preview(token).expect(200);
    await reset(token).expect(204);

    await login(email, NEW_PASSWORD).expect(200);
  });

  it('refuses an unknown, an expired, a used and a suspended link in the same words', async () => {
    // One message for four causes: a preview that told them apart is the oracle
    // the POST refuses to be, reachable without submitting a form.
    const unknown = await preview('not-a-real-token');

    const expiredSetup = await requestReset();
    const expiredToken = tokenFromEmail();
    await prisma.passwordResetToken.updateMany({
      where: { userId: expiredSetup.userId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const expired = await preview(expiredToken);

    await requestReset();
    const usedToken = tokenFromEmail();
    await reset(usedToken).expect(204);
    const used = await preview(usedToken);

    const suspendedSetup = await requestReset();
    const suspendedToken = tokenFromEmail();
    await suspendAsAdmin(app, suspendedSetup.userId, 'testing');
    const suspended = await preview(suspendedToken);

    for (const res of [unknown, expired, used, suspended]) {
      expect(res.status).toBe(401);
      expect((res.body as { detail: string }).detail).toBe(RESET_LINK_INVALID);
    }
  });

  it('never echoes the token back', async () => {
    await requestReset();
    const token = tokenFromEmail();

    const res = await preview(token).expect(200);

    expect(res.text).not.toContain(token);
  });
});

describe('POST /auth/reset-password', () => {
  async function requestReset() {
    const email = `${uniq('reset')}@uni.ac.ae`;
    const signedUp = await signupAndKeepCookies(app, { email, password: PASSWORD });
    await forgot(email).expect(202);
    return { email, userId: signedUp.userId, refreshCookie: signedUp.refreshCookie };
  }

  it('changes the password, so the old one stops working and the new one starts', async () => {
    const { email } = await requestReset();

    await reset(tokenFromEmail()).expect(204);

    await login(email, PASSWORD).expect(401);
    await login(email, NEW_PASSWORD).expect(200);
  });

  it('revokes every refresh token the account holds, in the same transaction', async () => {
    // A reset leaving other sessions able to renew for thirty days is not a reset.
    const { userId, refreshCookie } = await requestReset();

    // Live before the reset, so the 401 afterwards is the reset's doing and not
    // a token that never worked.
    await refresh(app, refreshCookie).expect(200);

    await reset(tokenFromEmail()).expect(204);

    const after = await refresh(app, refreshCookie).expect(401);
    expect(after.body.detail).toBe(SESSION_EXPIRED);
    expect(await prisma.refreshToken.count({ where: { userId, revokedAt: null } })).toBe(0);
  });

  it('works once, and refuses the same token the second time', async () => {
    const { userId } = await requestReset();
    const token = tokenFromEmail();

    await reset(token).expect(204);
    const second = await reset(token, 'yet-another-password').expect(401);

    expect(second.body.detail).toBe(RESET_LINK_INVALID);
    // The second attempt changed nothing.
    await login((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).email, NEW_PASSWORD).expect(200);
  });

  it('refuses an expired token with the same message as an unknown one', async () => {
    const { userId } = await requestReset();
    const token = tokenFromEmail();
    await prisma.passwordResetToken.updateMany({
      where: { userId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const expired = await reset(token).expect(401);
    expect(expired.body.detail).toBe(RESET_LINK_INVALID);

    const unknown = await reset('a-token-that-was-never-issued').expect(401);
    expect(unknown.body.detail).toBe(RESET_LINK_INVALID);

    // The password is untouched.
    await login((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).email, PASSWORD).expect(200);
  });

  it('refuses a token whose account was suspended after the link was sent', async () => {
    const { userId } = await requestReset();
    const token = tokenFromEmail();
    await suspendAsAdmin(app, userId, 'testing');

    const res = await reset(token).expect(401);
    expect(res.body.detail).toBe(RESET_LINK_INVALID);
    // A refusal does not consume the token: the transaction rolls back.
    expect((await prisma.passwordResetToken.findFirstOrThrow({ where: { userId } })).usedAt).toBeNull();
  });

  it('rejects a password below the minimum length before touching anything', async () => {
    const { userId } = await requestReset();
    const token = tokenFromEmail();

    await reset(token, 'short').expect(400);

    expect((await prisma.passwordResetToken.findFirstOrThrow({ where: { userId } })).usedAt).toBeNull();
  });

  it('audits the reset in the same transaction as the password change', async () => {
    const { userId } = await requestReset();
    await reset(tokenFromEmail()).expect(204);

    const rows = await prisma.auditLog.findMany({ where: { entityId: userId } });
    expect(rows.map((r) => r.action)).toContain('auth.password_reset');
    expect(rows.map((r) => r.action)).toContain('auth.password_reset_requested');
  });
});

describe('the reset link', () => {
  it('is never returned by the inbox, whose rows a browser caches', async () => {
    const email = `${uniq('reset')}@uni.ac.ae`;
    const signedUp = await signupAndKeepCookies(app, { email, password: PASSWORD });
    await forgot(email).expect(202);
    const raw = tokenFromEmail();

    const res = await request(app.getHttpServer())
      .get(`${API_PREFIX}/me/notifications`)
      .set('Cookie', signedUp.sessionCookie)
      .expect(200);

    expect(JSON.stringify(res.body)).not.toContain(raw);
  });

  it('is the only place the raw token exists outside the minting request', async () => {
    const email = `${uniq('reset')}@uni.ac.ae`;
    const res = await signup(app, { email, password: PASSWORD }).expect(201);
    const userId = (res.body as { id: string }).id;
    const answer = await forgot(email).expect(202);
    const raw = tokenFromEmail();

    // Not in the HTTP response, which is why the 202 carries nothing.
    expect(answer.text).not.toContain(raw);
    // And not in the audit trail, which never holds a token.
    const audit = await prisma.auditLog.findMany({ where: { entityId: userId } });
    expect(JSON.stringify(audit)).not.toContain(raw);
  });

  it('is not in the notification row either, which the API exclusion would not help with', async () => {
    // The reset table stores only a sha256 so that reading it yields nothing.
    // Catches a live URL in notification.payload, which hands back working links
    // for every pending request, in rows that outlive the tokens' expiry.
    const email = `${uniq('reset')}@uni.ac.ae`;
    const res = await signup(app, { email, password: PASSWORD }).expect(201);
    const userId = (res.body as { id: string }).id;

    await forgot(email).expect(202);
    const raw = tokenFromEmail();

    const row = await prisma.notification.findFirstOrThrow({
      where: { userId, type: 'auth.password_reset' },
    });
    const serialized = JSON.stringify(row);
    expect(serialized).not.toContain(raw);
    expect(serialized).not.toContain('reset-password?token=');
    expect(row.payload).toEqual({ expiresInMinutes: 30 });
  });

  it('is delivered inline, so the sweep never has a reset to pick up', async () => {
    // A PENDING row would have the sweep send a second email from a payload
    // with no link in it.
    const email = `${uniq('reset')}@uni.ac.ae`;
    await signup(app, { email, password: PASSWORD }).expect(201);
    await forgot(email).expect(202);

    expect(await prisma.notification.count({ where: { emailStatus: 'PENDING' } })).toBe(0);
    expect(delivered).toHaveLength(1);
  });
});

describe('cookies issued before a reset', () => {
  it('are refused at the refresh endpoint even when presented as a whole cookie jar', async () => {
    const email = `${uniq('reset')}@uni.ac.ae`;
    const signedUp = await signupAndKeepCookies(app, { email, password: PASSWORD });
    await forgot(email).expect(202);
    await reset(tokenFromEmail()).expect(204);

    const relogin = await login(email, NEW_PASSWORD).expect(200);
    // The new session works, so the refusal below is about the old token rather
    // than refresh being broken for this account.
    await refresh(app, refreshCookieOf(relogin)).expect(200);
    await refresh(app, signedUp.refreshCookie).expect(401);
  });

  it('stop working as a SESSION cookie the instant the reset commits', async () => {
    // Revoking refresh tokens only ends renewal. The access token is a stateless
    // 15 minute JWT, so without SessionGuard's sessionsInvalidatedAt comparison
    // a stolen cookie keeps working for a quarter of an hour after the reset.
    const email = `${uniq('reset')}@uni.ac.ae`;
    const signedUp = await signupAndKeepCookies(app, { email, password: PASSWORD });

    // Live before the reset, so the 401 below is the reset's doing.
    await request(app.getHttpServer())
      .get(`${API_PREFIX}/auth/me`)
      .set('Cookie', signedUp.sessionCookie)
      .expect(200);

    await forgot(email).expect(202);
    await reset(tokenFromEmail()).expect(204);

    const after = await request(app.getHttpServer())
      .get(`${API_PREFIX}/auth/me`)
      .set('Cookie', signedUp.sessionCookie)
      .expect(401);
    expect(after.body.detail).toBe('Not signed in.');

    // The account is fine: it is the pre-reset token that is dead.
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: signedUp.userId } })).status,
    ).toBe('ACTIVE');
  });
});
