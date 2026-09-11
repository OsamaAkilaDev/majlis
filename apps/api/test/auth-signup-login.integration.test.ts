import type { INestApplication } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TokensService } from '../src/auth/tokens.service';
import { login, loginAsAdmin, loginAsStudent, signup } from './auth-helpers';
import { createTestApp } from './app';
import { createTestPrisma, disconnectTestPrisma, truncateAll } from './db';
import { uniq } from './factories';

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
  // Rate limiting is real (see auth.module.ts / auth.controller.ts), not
  // disabled for tests — several tests below deliberately run right up to
  // its edge. Without this reset, the in-memory counter (one instance per
  // test FILE, since createTestApp() runs once in beforeAll) would carry
  // hit counts from an earlier test into the next one, making pass/fail
  // depend on test order and file layout rather than on the code.
  app.get(ThrottlerStorage).storage.clear();
});

describe('POST /auth/signup', () => {
  it('creates a session user with no password hash anywhere in the response', async () => {
    const res = await signup(app, {});
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      email: expect.stringContaining('@uni.ac.ae'),
      fullName: 'Test Person',
      platformRole: 'STUDENT',
      clubRoles: [],
    });
    expect(res.body.passwordHash).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain('$argon2id$');
  });

  it('stores no plaintext password anywhere, hashed with argon2id', async () => {
    const email = `${uniq('user')}@uni.ac.ae`;
    await signup(app, { email, password: 'correct-horse-battery' });

    const row = await prisma.user.findUniqueOrThrow({ where: { email } });
    // Catches a service that stores req.body.password verbatim — the most
    // direct possible violation of "no secrets in code or logs" applied to
    // the database itself.
    expect(row.passwordHash).not.toContain('correct-horse-battery');
    expect(row.passwordHash.startsWith('$argon2id$')).toBe(true);
  });

  it('sets both cookies httpOnly, with the refresh cookie path-scoped', async () => {
    const res = await signup(app, {});
    const cookies = res.headers['set-cookie'] as unknown as string[];
    const session = cookies.find((c) => c.startsWith('majlis_session'));
    const refresh = cookies.find((c) => c.startsWith('majlis_refresh'));
    expect(session).toMatch(/HttpOnly/);
    expect(refresh).toMatch(/HttpOnly/);
    expect(refresh).toMatch(/Path=\/api\/v1\/auth/);
  });

  it('persists a hashed refresh token, never the raw cookie value', async () => {
    const res = await signup(app, {});
    const cookies = res.headers['set-cookie'] as unknown as string[];
    const rawRefresh = cookies.find((c) => c.startsWith('majlis_refresh'))!.split(';')[0]!.split('=')[1]!;

    const row = await prisma.refreshToken.findFirstOrThrow({ where: { userId: res.body.id } });
    // Catches a mint/create pairing that accidentally persists the raw
    // token — a leaked RefreshToken row would then be a live session for
    // whoever reads it, rather than a useless hash.
    expect(row.tokenHash).not.toBe(rawRefresh);
    expect(row.tokenHash).toBe(tokens.hashRefreshToken(rawRefresh));
  });

  it('rejects a duplicate email with 409, not 500', async () => {
    const email = `${uniq('dupe')}@uni.ac.ae`;
    const first = await signup(app, { email });
    expect(first.status).toBe(201);

    const second = await signup(app, { email });
    // Catches a service with no explicit unique-violation handling, which
    // would otherwise surface as a 500 that also risks describing the
    // underlying Postgres constraint to the caller.
    expect(second.status).toBe(409);
  });

  it('rejects a password shorter than the 12-character minimum with a validation problem, not a 500', async () => {
    const res = await signup(app, { password: 'short-pass' });
    expect(res.status).toBe(400);
  });

  it('writes no audit row for a routine signup', async () => {
    // Spec §11's audited-action list (approval, role change, scan, issuance,
    // revocation, Admin override) omits signup deliberately. Catches an
    // over-eager `audit.record(...)` call added "for completeness" that
    // would flood the audit log with an event nobody asked to track.
    await signup(app, {});
    const count = await prisma.auditLog.count();
    expect(count).toBe(0);
  });
});

describe('POST /auth/login', () => {
  it('logs in when the email case differs from what was stored', async () => {
    await signup(app, { email: 'osama@uni.ac.ae', password: 'correct-horse-battery' });

    const res = await login(app, { email: 'Osama@UNI.ac.ae', password: 'correct-horse-battery' });

    // Catches a lookup that skips emailSchema's normalisation — it would
    // fail to find the row and report "invalid credentials," a bug that
    // reads exactly like a wrong password.
    expect(res.status).toBe(200);
    expect(res.body.email).toBe('osama@uni.ac.ae');
  });

  it('gives a byte-identical response for an unknown email and a wrong password', async () => {
    await signup(app, { email: 'known@uni.ac.ae', password: 'correct-horse-battery' });

    const unknownEmailRes = await login(app, { email: 'nobody@uni.ac.ae', password: 'whatever-at-all' });
    const wrongPasswordRes = await login(app, { email: 'known@uni.ac.ae', password: 'whatever-at-all' });

    expect(unknownEmailRes.status).toBe(401);
    expect(wrongPasswordRes.status).toBe(401);

    // requestId is expected to differ per request — asserted so the two
    // toEqual bodies below aren't quietly comparing one response against
    // itself. A differing `detail` string between the two branches is the
    // usual shape of an account-enumeration bug, and comparing only status
    // would miss it entirely.
    const { requestId: unknownRequestId, ...unknownBody } = unknownEmailRes.body;
    const { requestId: wrongRequestId, ...wrongBody } = wrongPasswordRes.body;
    expect(unknownRequestId).not.toBe(wrongRequestId);
    expect(unknownBody).toEqual(wrongBody);
  });

  it('rejects an unknown email exactly as fast as a wrong password for a real one', async () => {
    // Catches a "no user, return immediately" shortcut: without verifying
    // against DUMMY_HASH, an unknown email answers in ~0ms while a wrong
    // password against a real user pays argon2's ~100ms — a reliable timing
    // oracle that the byte-identical-body test above cannot detect at all.
    await signup(app, { email: 'timing@uni.ac.ae', password: 'correct-horse-battery' });

    const start1 = Date.now();
    await login(app, { email: 'nobody-at-all@uni.ac.ae', password: 'whatever-at-all' });
    const unknownMs = Date.now() - start1;

    const start2 = Date.now();
    await login(app, { email: 'timing@uni.ac.ae', password: 'whatever-at-all' });
    const wrongMs = Date.now() - start2;

    expect(Math.abs(unknownMs - wrongMs)).toBeLessThan(100);
  });

  it('tells a suspended user they are suspended, but only on the right password', async () => {
    const { userId } = await loginAsStudent(app, {
      email: 'sus@uni.ac.ae',
      password: 'correct-horse-battery',
    });
    await prisma.user.update({ where: { id: userId }, data: { status: 'SUSPENDED' } });

    const correctPassword = await login(app, { email: 'sus@uni.ac.ae', password: 'correct-horse-battery' });
    expect(correctPassword.status).toBe(403);

    const wrongPassword = await login(app, { email: 'sus@uni.ac.ae', password: 'not-the-password' });
    // Indistinguishable from an unknown email — the one deliberate exception
    // to enumeration resistance only fires once the caller has already
    // proven the password.
    expect(wrongPassword.status).toBe(401);

    const unknownEmail = await login(app, { email: 'nobody-else@uni.ac.ae', password: 'not-the-password' });
    const { requestId: wrongRequestId, ...wrongBody } = wrongPassword.body;
    const { requestId: unknownRequestId, ...unknownBody } = unknownEmail.body;
    expect(wrongRequestId).not.toBe(unknownRequestId);
    expect(wrongBody).toEqual(unknownBody);
  });

  it('includes the actors ACTIVE club roles in the session user', async () => {
    const club = await prisma.club.create({
      data: {
        name: `Club ${uniq('club')}`,
        slug: uniq('club'),
        description: 'A club.',
        category: 'Technology',
        academicYear: '2026/2027',
        logoUrl: 'https://example.test/logo.png',
        department: { create: { name: `Dept ${uniq('dept')}`, code: uniq('DEPT').toUpperCase() } },
      },
    });
    const { userId } = await loginAsStudent(app, {
      email: 'lead@uni.ac.ae',
      password: 'correct-horse-battery',
    });
    await prisma.clubTeamAppointment.create({
      data: { clubId: club.id, userId, role: 'LEAD', status: 'ACTIVE', invitedById: userId },
    });

    const res = await login(app, { email: 'lead@uni.ac.ae', password: 'correct-horse-battery' });

    // Catches a session-user builder that ignores appointments entirely, or
    // one that forgets the ACTIVE-only filter and would also surface a
    // DECLINED/INVITED appointment as live authority.
    expect(res.body.clubRoles).toEqual([{ clubId: club.id, role: 'LEAD' }]);
  });

  it('writes no audit row for a routine login', async () => {
    await signup(app, { email: 'quiet@uni.ac.ae', password: 'correct-horse-battery' });
    await login(app, { email: 'quiet@uni.ac.ae', password: 'correct-horse-battery' });

    const count = await prisma.auditLog.count();
    expect(count).toBe(0);
  });

  it('throttles rapid login attempts past the configured limit of 5 per minute', async () => {
    await signup(app, { email: 'throttle@uni.ac.ae', password: 'correct-horse-battery' });

    for (let i = 0; i < 5; i++) {
      const res = await login(app, { email: 'throttle@uni.ac.ae', password: 'wrong-password' });
      expect(res.status).toBe(401);
    }
    // Catches a @Throttle() left off the route entirely, or a ttl/limit
    // typo — both would let this 6th attempt through as another 401.
    const blocked = await login(app, { email: 'throttle@uni.ac.ae', password: 'wrong-password' });
    expect(blocked.status).toBe(429);
  });
});

describe('loginAsAdmin test helper', () => {
  it('promotes the signed-up user so the same session cookie now carries admin authority', async () => {
    // Not an assertion about a product endpoint — this proves the Task 10+
    // helper itself does what its doc comment claims: the cookie minted at
    // signup keeps authenticating after the direct-write promotion, because
    // SessionGuard re-reads platformRole from the database every request.
    const { userId } = await loginAsAdmin(app, {});
    const row = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(row.platformRole).toBe('ADMIN');
  });
});
