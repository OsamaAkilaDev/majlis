import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { RESET_LINK_INVALID, SESSION_EXPIRED } from '../src/auth/auth.service';
import { TokensService } from '../src/auth/tokens.service';
import { API_PREFIX } from '../src/config/api-prefix';
import { createTestApp } from './app';
import { refresh, refreshCookieOf, signup, signupAndKeepCookies, suspendAsAdmin } from './auth-helpers';
import { createTestPrisma, disconnectTestPrisma, truncateAll } from './db';
import { uniq } from './factories';

const prisma = createTestPrisma();
let app: INestApplication;

const PASSWORD = 'correct-horse-battery';
const NEW_PASSWORD = 'a-completely-different-one';

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

function forgot(email: string) {
  return request(app.getHttpServer()).post(`${API_PREFIX}/auth/forgot-password`).send({ email });
}

function reset(token: string, password = NEW_PASSWORD) {
  return request(app.getHttpServer())
    .post(`${API_PREFIX}/auth/reset-password`)
    .send({ token, password });
}

function login(email: string, password: string) {
  return request(app.getHttpServer()).post(`${API_PREFIX}/auth/login`).send({ email, password });
}

/**
 * The raw token, read out of the notification the request wrote. With no
 * RESEND_API_KEY there is no email, and this is the only place the raw value
 * ever exists outside the request that minted it.
 */
async function tokenFromNotification(userId: string): Promise<string> {
  const row = await prisma.notification.findFirstOrThrow({
    where: { userId, type: 'auth.password_reset' },
    orderBy: { id: 'desc' },
  });
  const { resetUrl } = row.payload as { resetUrl: string };
  return new URL(resetUrl).searchParams.get('token')!;
}

describe('POST /auth/forgot-password', () => {
  it('answers 202 identically for a real address and an unknown one', async () => {
    // Any difference here, in status or in body, is an account-existence
    // oracle: an unauthenticated caller could enumerate who holds an account.
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
    // The mirror of the test above: identical answers must not be achieved
    // by doing nothing at all.
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
    const raw = await tokenFromNotification(userId);
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

describe('POST /auth/reset-password', () => {
  async function requestReset() {
    const email = `${uniq('reset')}@uni.ac.ae`;
    const signedUp = await signupAndKeepCookies(app, { email, password: PASSWORD });
    await forgot(email).expect(202);
    return { email, userId: signedUp.userId, refreshCookie: signedUp.refreshCookie };
  }

  it('changes the password, so the old one stops working and the new one starts', async () => {
    const { email, userId } = await requestReset();

    await reset(await tokenFromNotification(userId)).expect(204);

    await login(email, PASSWORD).expect(401);
    await login(email, NEW_PASSWORD).expect(200);
  });

  it('revokes every refresh token the account holds, in the same transaction', async () => {
    // A reset that leaves the account's other sessions able to renew
    // themselves for thirty days is not a reset.
    const { userId, refreshCookie } = await requestReset();

    // The session was live before the reset, so a 401 afterwards is the
    // reset's doing and not a token that never worked.
    await refresh(app, refreshCookie).expect(200);

    await reset(await tokenFromNotification(userId)).expect(204);

    const after = await refresh(app, refreshCookie).expect(401);
    expect(after.body.detail).toBe(SESSION_EXPIRED);
    expect(await prisma.refreshToken.count({ where: { userId, revokedAt: null } })).toBe(0);
  });

  it('works once, and refuses the same token the second time', async () => {
    const { userId } = await requestReset();
    const token = await tokenFromNotification(userId);

    await reset(token).expect(204);
    const second = await reset(token, 'yet-another-password').expect(401);

    expect(second.body.detail).toBe(RESET_LINK_INVALID);
    // And the second attempt changed nothing.
    await login((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).email, NEW_PASSWORD).expect(200);
  });

  it('refuses an expired token with the same message as an unknown one', async () => {
    const { userId } = await requestReset();
    const token = await tokenFromNotification(userId);
    await prisma.passwordResetToken.updateMany({
      where: { userId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const expired = await reset(token).expect(401);
    expect(expired.body.detail).toBe(RESET_LINK_INVALID);

    const unknown = await reset('a-token-that-was-never-issued').expect(401);
    expect(unknown.body.detail).toBe(RESET_LINK_INVALID);

    // And the password is untouched.
    await login((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).email, PASSWORD).expect(200);
  });

  it('refuses a token whose account was suspended after the link was sent', async () => {
    const { userId } = await requestReset();
    const token = await tokenFromNotification(userId);
    await suspendAsAdmin(app, userId, 'testing');

    const res = await reset(token).expect(401);
    expect(res.body.detail).toBe(RESET_LINK_INVALID);
    // The token is not consumed by a refusal, because the whole transaction
    // rolls back with the throw.
    expect((await prisma.passwordResetToken.findFirstOrThrow({ where: { userId } })).usedAt).toBeNull();
  });

  it('rejects a password below the minimum length before touching anything', async () => {
    const { userId } = await requestReset();
    const token = await tokenFromNotification(userId);

    await reset(token, 'short').expect(400);

    expect((await prisma.passwordResetToken.findFirstOrThrow({ where: { userId } })).usedAt).toBeNull();
  });

  it('audits the reset in the same transaction as the password change', async () => {
    const { userId } = await requestReset();
    await reset(await tokenFromNotification(userId)).expect(204);

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
    const raw = await tokenFromNotification(signedUp.userId);

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
    const raw = await tokenFromNotification(userId);

    // Not in the HTTP response, which is what makes the 202 carry nothing.
    expect(answer.text).not.toContain(raw);
    // And not in the audit trail, which spec 5.1 says never holds a token.
    const audit = await prisma.auditLog.findMany({ where: { entityId: userId } });
    expect(JSON.stringify(audit)).not.toContain(raw);
  });
});

describe('cookies issued before a reset', () => {
  it('are refused at the refresh endpoint even when presented as a whole cookie jar', async () => {
    const email = `${uniq('reset')}@uni.ac.ae`;
    const signedUp = await signupAndKeepCookies(app, { email, password: PASSWORD });
    await forgot(email).expect(202);
    await reset(await tokenFromNotification(signedUp.userId)).expect(204);

    const relogin = await login(email, NEW_PASSWORD).expect(200);
    // The new session works, so the refusal above is about the old token
    // rather than about refresh being broken for this account.
    await refresh(app, refreshCookieOf(relogin)).expect(200);
    await refresh(app, signedUp.refreshCookie).expect(401);
  });
});
