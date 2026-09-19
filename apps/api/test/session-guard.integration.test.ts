import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SESSION_COOKIE } from '../src/auth/cookies';
import { TokensService } from '../src/auth/tokens.service';
import { API_PREFIX } from '../src/config/api-prefix';
import { createTestApp } from './app';
import { createTestPrisma, disconnectTestPrisma, truncateAll } from './db';
import { mkUser } from './factories';
import { ProtectedTestModule } from './fixtures/protected.controller';
import { registeredRoutes } from './registered-routes';

const prisma = createTestPrisma();
const PROTECTED_PATH = `${API_PREFIX}/__test/protected`;

let app: INestApplication;
let tokens: TokensService;

beforeAll(async () => {
  // ProtectedTestModule is added only here, never in AppModule. SessionGuard
  // still applies: it is AppModule's global APP_GUARD, which every test app
  // compiles whatever extra module carries the fixture controller.
  app = await createTestApp([ProtectedTestModule]);
  tokens = app.get(TokensService);
});

afterAll(async () => {
  await app.close();
  await disconnectTestPrisma(prisma);
});

beforeEach(async () => {
  await truncateAll(prisma);
});

/** Mints a real, still-valid 15-minute access token and its cookie header. */
async function sessionCookieFor(userId: string): Promise<string> {
  const token = await tokens.signAccessToken(userId);
  return `${SESSION_COOKIE}=${token}`;
}

describe('SessionGuard', () => {
  it('rejects a still-unexpired access token once the user is suspended', async () => {
    // Catches a guard that verifies the JWT and trusts it, skipping the
    // per-request user lookup: it passes every other test here while giving a
    // suspended user the rest of the token's 15 minutes.
    const user = await mkUser();
    const cookie = await sessionCookieFor(user.id);
    await prisma.user.update({ where: { id: user.id }, data: { status: 'SUSPENDED' } });

    const res = await request(app.getHttpServer()).get(PROTECTED_PATH).set('Cookie', cookie);
    expect(res.status).toBe(401);
  });

  it('gives a suspended user the identical rejection body a missing cookie gets', async () => {
    // Catches a suspended branch given a more specific message: anyone holding a
    // stale cookie could then tell "suspended" from "not signed in".
    const user = await mkUser();
    const cookie = await sessionCookieFor(user.id);
    await prisma.user.update({ where: { id: user.id }, data: { status: 'SUSPENDED' } });

    const suspended = await request(app.getHttpServer()).get(PROTECTED_PATH).set('Cookie', cookie);
    const noCookie = await request(app.getHttpServer()).get(PROTECTED_PATH);

    // requestId must differ, so the toEqual below is not comparing one cached
    // response against itself. Every other field must match, not just status.
    const { requestId: suspendedRequestId, ...suspendedBody } = suspended.body;
    const { requestId: noCookieRequestId, ...noCookieBody } = noCookie.body;
    expect(suspendedRequestId).not.toBe(noCookieRequestId);
    expect(suspendedBody).toEqual(noCookieBody);
  });

  it('rejects a request with no session cookie at all', async () => {
    const res = await request(app.getHttpServer()).get(PROTECTED_PATH);

    expect(res.status).toBe(401);
    // Guards run outside some Nest pipelines, so this pins that a guard's
    // UnauthorizedError still reaches ProblemExceptionFilter.
    expect(res.headers['content-type']).toMatch(/application\/problem\+json/);
    expect(res.body.status).toBe(401);
  });

  it('rejects a token whose user row has been deleted', async () => {
    const user = await mkUser();
    const cookie = await sessionCookieFor(user.id);
    await prisma.user.delete({ where: { id: user.id } });

    const res = await request(app.getHttpServer()).get(PROTECTED_PATH).set('Cookie', cookie);
    expect(res.status).toBe(401); // 401, never 500
  });

  it('allows an active user with a valid session through to a protected route', async () => {
    // Positive control: a guard rejecting everything passes the three tests
    // above and the enumeration below.
    const user = await mkUser();
    const cookie = await sessionCookieFor(user.id);

    const res = await request(app.getHttpServer()).get(PROTECTED_PATH).set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: user.id });
  });

  it('allows @Public() routes without a cookie', async () => {
    const res = await request(app.getHttpServer()).get(`${API_PREFIX}/health`);
    expect(res.status).toBe(200);
  });

  it('leaves /api/v1/docs reachable without a session: Swagger mounts outside the Nest router', async () => {
    const res = await request(app.getHttpServer()).get(`${API_PREFIX}/docs`);
    expect(res.status).toBe(200);
  });

  it('protects every non-public route by default', async () => {
    // Enumerates the Nest container's route table, not a hand-maintained list,
    // so a new unprotected route turns this red with no test edit.
    const routes = registeredRoutes(app).filter((r) => !r.isPublic);
    expect(routes.length).toBeGreaterThan(0); // otherwise this passes vacuously

    for (const route of routes) {
      const res = await request(app.getHttpServer())[route.method](route.path);
      // 401 specifically, not just "not 200": a 403 or 500 for an unrelated
      // reason would otherwise read as protected, masking a guard that never ran.
      expect(res.status, `${route.method.toUpperCase()} ${route.path} is unprotected`).toBe(401);
    }
  });
});
