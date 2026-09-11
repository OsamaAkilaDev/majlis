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
  // ProtectedTestModule is added only here, never in AppModule — Task 11
  // brings the real /me route. SessionGuard still applies: it is AppModule's
  // global APP_GUARD, and every test app compiles AppModule regardless of
  // which extra module carries this fixture controller.
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
    // per-request user lookup. That guard passes every other test in this
    // file — login-equivalent, protected access, logout-equivalent — while
    // silently giving a suspended user the rest of the token's 15-minute
    // life. Spec §1's first guarantee is that suspension takes effect on the
    // very next request, not at token expiry.
    const user = await mkUser();
    const cookie = await sessionCookieFor(user.id);
    await prisma.user.update({ where: { id: user.id }, data: { status: 'SUSPENDED' } });

    const res = await request(app.getHttpServer()).get(PROTECTED_PATH).set('Cookie', cookie);
    expect(res.status).toBe(401);
  });

  it('gives a suspended user the identical rejection body a missing cookie gets', async () => {
    // The code is correct today — both branches throw the same
    // UnauthorizedError('Not signed in.') — but nothing above pins that.
    // Catches a later refactor that gives the suspended branch a more
    // specific message (e.g. 'Account suspended.'): that would let anyone
    // holding a stale cookie for a suspended account distinguish "this
    // account exists and was suspended" from "not signed in", leaking
    // account state to a caller who no longer has valid credentials.
    const user = await mkUser();
    const cookie = await sessionCookieFor(user.id);
    await prisma.user.update({ where: { id: user.id }, data: { status: 'SUSPENDED' } });

    const suspended = await request(app.getHttpServer()).get(PROTECTED_PATH).set('Cookie', cookie);
    const noCookie = await request(app.getHttpServer()).get(PROTECTED_PATH);

    // requestId is expected to differ per request — asserted here so the
    // two toEqual bodies below aren't quietly comparing one cached response
    // against itself. Every other field — type, title, status, detail,
    // instance — must be identical, not just status.
    const { requestId: suspendedRequestId, ...suspendedBody } = suspended.body;
    const { requestId: noCookieRequestId, ...noCookieBody } = noCookie.body;
    expect(suspendedRequestId).not.toBe(noCookieRequestId);
    expect(suspendedBody).toEqual(noCookieBody);
  });

  it('rejects a request with no session cookie at all', async () => {
    const res = await request(app.getHttpServer()).get(PROTECTED_PATH);

    expect(res.status).toBe(401);
    // Guards run outside some Nest pipelines; this pins that a guard's
    // UnauthorizedError still reaches ProblemExceptionFilter rather than
    // bypassing it for a bare Nest default error shape.
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
    // A positive control: without it, a guard that rejects every request
    // outright would still pass the three tests above and the blanket
    // enumeration below.
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

  it('leaves /api/v1/docs reachable without a session — Swagger mounts outside the Nest router', async () => {
    const res = await request(app.getHttpServer()).get(`${API_PREFIX}/docs`);
    expect(res.status).toBe(200);
  });

  it('protects every non-public route by default', async () => {
    // Enumerates the route table from the Nest container rather than a
    // hand-maintained path list, so a route added in a later stage that
    // forgets to think about auth turns this red without anyone remembering
    // to update this test.
    const routes = registeredRoutes(app).filter((r) => !r.isPublic);
    expect(routes.length).toBeGreaterThan(0); // otherwise this passes vacuously

    for (const route of routes) {
      const res = await request(app.getHttpServer())[route.method](route.path);
      // 401 specifically, not just "not 200": a route that answers 403 or
      // 500 for an unrelated reason would otherwise pass as "protected",
      // masking a guard that never actually ran on it.
      expect(res.status, `${route.method.toUpperCase()} ${route.path} is unprotected`).toBe(401);
    }
  });
});
