import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { API_PREFIX } from '../src/config/api-prefix';
import { SESSION_COOKIE } from '../src/auth/cookies';
import { TokensService } from '../src/auth/tokens.service';
import { allCookiesOf, rawRefreshTokenFrom, refresh, refreshCookieOf, signup } from './auth-helpers';
import { createTestApp } from './app';
import { createTestPrisma, disconnectTestPrisma, truncateAll } from './db';

const LOGOUT_PATH = `${API_PREFIX}/auth/logout`;
const ME_PATH = `${API_PREFIX}/auth/me`;

const me = (cookie: string) => request(app.getHttpServer()).get(ME_PATH).set('Cookie', cookie);

const prisma = createTestPrisma();

let app: INestApplication;
let tokens: TokensService;

beforeAll(async () => {
  app = await createTestApp();
  tokens = app.get(TokensService);
});

afterAll(async () => {
  await app.close();
  await disconnectTestPrisma(prisma);
});

beforeEach(async () => {
  await truncateAll(prisma);
});

describe('POST /auth/refresh', () => {
  it('returns a fresh session and keeps the same refresh token', async () => {
    const first = await signup(app, {});

    const res = await refresh(app, refreshCookieOf(first));

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(first.body.id);
    // The token is revocable, not rotating. Catches a half-reverted rotation
    // that mints a successor but never revokes the original, leaving two
    // live credentials where the design says there is one.
    expect(rawRefreshTokenFrom(res)).toBe(rawRefreshTokenFrom(first));
    expect(await prisma.refreshToken.count({ where: { userId: first.body.id } })).toBe(1);
  });

  it('never stores the raw refresh token', async () => {
    const s = await signup(app, {});
    const raw = rawRefreshTokenFrom(s);

    const all = await prisma.refreshToken.findMany();
    // Catches a mint that persists the raw cookie value instead of its hash.
    expect(all.some((r) => r.tokenHash === raw)).toBe(false);
    expect(all).toHaveLength(1);
  });

  it('rejects a refresh for a user suspended since the token was issued', async () => {
    const s = await signup(app, {});
    await prisma.user.update({ where: { id: s.body.id }, data: { status: 'SUSPENDED' } });

    // Catches a refresh that trusts the stored row without re-reading the
    // user: suspension has to bite here as well as on the session guard.
    expect((await refresh(app, refreshCookieOf(s))).status).toBe(401);
  });

  it('rejects an unknown refresh token', async () => {
    // Catches a lookup that throws an unhandled error (500) rather than the
    // domain 401 every other failure path returns.
    const res = await refresh(app, 'majlis_refresh=not-a-real-token-at-all');
    expect(res.status).toBe(401);
  });

  it('rejects an expired refresh token', async () => {
    const s = await signup(app, {});
    await prisma.refreshToken.update({
      where: { tokenHash: tokens.hashRefreshToken(rawRefreshTokenFrom(s)) },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    expect((await refresh(app, refreshCookieOf(s))).status).toBe(401);
  });

  it('gives an identical response across expiry, revocation, an unknown token, a suspended user, and no cookie', async () => {
    // Five independently-broken cases, five root causes. The client must not
    // be able to tell them apart. Includes the controller's own missing-cookie
    // branch, the one path that never reaches AuthService.refresh.
    const expired = await signup(app, {});
    await prisma.refreshToken.update({
      where: { tokenHash: tokens.hashRefreshToken(rawRefreshTokenFrom(expired)) },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const revoked = await signup(app, {});
    await request(app.getHttpServer()).post(LOGOUT_PATH).set('Cookie', refreshCookieOf(revoked));

    const suspended = await signup(app, {});
    await prisma.user.update({ where: { id: suspended.body.id }, data: { status: 'SUSPENDED' } });

    const [expiredRes, revokedRes, suspendedRes, unknownRes, noCookieRes] = await Promise.all([
      refresh(app, refreshCookieOf(expired)),
      refresh(app, refreshCookieOf(revoked)),
      refresh(app, refreshCookieOf(suspended)),
      refresh(app, 'majlis_refresh=not-a-real-token-at-all'),
      request(app.getHttpServer()).post(`${API_PREFIX}/auth/refresh`),
    ]);

    for (const res of [expiredRes, revokedRes, suspendedRes, unknownRes, noCookieRes]) {
      expect(res.status).toBe(401);
    }

    // requestId differs per request by design, stripped so it can't mask a
    // real difference in the rest of the body.
    const stripBody = (res: request.Response) => {
      const { requestId: _omitted, ...rest } = res.body as Record<string, unknown>;
      return rest;
    };
    const [expiredBody, revokedBody, suspendedBody, unknownBody, noCookieBody] = [
      expiredRes,
      revokedRes,
      suspendedRes,
      unknownRes,
      noCookieRes,
    ].map(stripBody);
    expect(expiredBody).toEqual(revokedBody);
    expect(expiredBody).toEqual(suspendedBody);
    expect(expiredBody).toEqual(unknownBody);
    expect(expiredBody).toEqual(noCookieBody);
  });
});

describe('POST /auth/logout', () => {
  it('logs out idempotently with no cookie at all', async () => {
    expect((await request(app.getHttpServer()).post(LOGOUT_PATH)).status).toBe(204);
  });

  it('logs out idempotently with an unknown or already-revoked token', async () => {
    const unknown = await request(app.getHttpServer())
      .post(LOGOUT_PATH)
      .set('Cookie', 'majlis_refresh=not-a-real-token-at-all');
    expect(unknown.status).toBe(204);

    const s = await signup(app, {});
    const cookie = refreshCookieOf(s);
    expect((await request(app.getHttpServer()).post(LOGOUT_PATH).set('Cookie', cookie)).status).toBe(
      204,
    );
    // Catches a logout that throws (500) or 4xxs on a token it already
    // revoked: a user retrying a slow request must not be punished for it.
    expect((await request(app.getHttpServer()).post(LOGOUT_PATH).set('Cookie', cookie)).status).toBe(
      204,
    );
  });

  it('clears both cookies on logout', async () => {
    const s = await signup(app, {});
    const res = await request(app.getHttpServer())
      .post(LOGOUT_PATH)
      .set('Cookie', allCookiesOf(s));
    const cleared = res.headers['set-cookie'] as unknown as string[];
    expect(cleared.join(';')).toMatch(/majlis_session=;/);
    expect(cleared.join(';')).toMatch(/majlis_refresh=;/);
  });

  it('revokes the token so a later refresh with it fails', async () => {
    const s = await signup(app, {});
    const cookie = refreshCookieOf(s);

    await request(app.getHttpServer()).post(LOGOUT_PATH).set('Cookie', cookie);

    // Catches a logout that clears cookies without revoking the row: the
    // cookie is gone from that browser, but the credential still works for
    // anyone who captured it. Revocation is the only thing ending a session
    // now that rotation is gone, so this is the load-bearing logout test.
    expect((await refresh(app, cookie)).status).toBe(401);
    const rows = await prisma.refreshToken.findMany({ where: { userId: s.body.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.revokedAt).not.toBeNull();
  });

  it('refuses the pre-logout access token, which revocation alone cannot reach', async () => {
    const s = await signup(app, {});
    const setCookie = s.headers['set-cookie'] as unknown as string[];
    const sessionCookie = setCookie.find((c) => c.startsWith(`${SESSION_COOKIE}=`))!.split(';')[0]!;

    // Live before, so a 401 afterwards cannot be blamed on the cookie never
    // having worked.
    expect((await me(sessionCookie)).status).toBe(200);

    expect(
      (await request(app.getHttpServer()).post(LOGOUT_PATH).set('Cookie', refreshCookieOf(s))).status,
    ).toBe(204);

    // Catches a logout that revokes the refresh family and stops there: the
    // access token is a stateless 15 minute JWT, so the session it belongs
    // to outlived the logout by up to fifteen minutes.
    expect((await me(sessionCookie)).status).toBe(401);
    // SessionGuard 401s a suspended account with the same message, so the
    // account has to be shown still ACTIVE or this test does not say which
    // branch refused it.
    expect((await prisma.user.findUniqueOrThrow({ where: { id: s.body.id } })).status).toBe('ACTIVE');
  });
});
