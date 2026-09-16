import type { INestApplication } from '@nestjs/common';
import { verify } from '@node-rs/argon2';
import type * as Argon2 from '@node-rs/argon2';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthService } from '../src/auth/auth.service';
import { TokensService } from '../src/auth/tokens.service';
import { login, loginAsAdmin, loginAsStudent, signup } from './auth-helpers';
import { createTestApp } from './app';
import { createTestPrisma, disconnectTestPrisma, truncateAll } from './db';
import { uniq } from './factories';

// A partial mock: `verify` is wrapped with a spy that still calls through to
// the real implementation, so every other test in this file gets real
// argon2 behaviour (real hashing, real rejection of a wrong password) and
// only gains the ability to assert what it was CALLED with. `hash` is left
// untouched entirely.
vi.mock('@node-rs/argon2', async (importOriginal) => {
  const actual = await importOriginal<typeof Argon2>();
  return { ...actual, verify: vi.fn(actual.verify) };
});

// AuthService.DUMMY_HASH is `private` at the type level only. TypeScript
// erases that at runtime, so the class still carries it as a real static
// property. Reading it here (rather than pasting a second copy of the
// literal into the test) means this test can never drift from the value
// actually used in production.
const DUMMY_HASH = (AuthService as unknown as { DUMMY_HASH: string }).DUMMY_HASH;

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
  vi.mocked(verify).mockClear();
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
    // Catches a service that stores req.body.password verbatim, the most
    // direct possible violation of "no secrets in code or logs" applied to
    // the database itself.
    expect(row.passwordHash).not.toContain('correct-horse-battery');
    expect(row.passwordHash.startsWith('$argon2id$')).toBe(true);
  });

  it('sets both cookies httpOnly, with the refresh cookie scoped to the site root', async () => {
    const res = await signup(app, {});
    const cookies = res.headers['set-cookie'] as unknown as string[];
    const session = cookies.find((c) => c.startsWith('majlis_session'));
    const refresh = cookies.find((c) => c.startsWith('majlis_refresh'));
    expect(session).toMatch(/HttpOnly/);
    expect(refresh).toMatch(/HttpOnly/);
    // Widened from /api/v1/auth to / in Stage 3 so Next.js middleware can see
    // the refresh cookie on a page navigation, not only on API calls. Anchored
    // to end-of-string or ';' so this cannot match Path=/api/v1/auth too.
    expect(refresh).toMatch(/Path=\/(;|$)/);
  });

  it('persists a hashed refresh token, never the raw cookie value', async () => {
    const res = await signup(app, {});
    const cookies = res.headers['set-cookie'] as unknown as string[];
    const rawRefresh = cookies.find((c) => c.startsWith('majlis_refresh'))!.split(';')[0]!.split('=')[1]!;

    const row = await prisma.refreshToken.findFirstOrThrow({ where: { userId: res.body.id } });
    // Catches a mint/create pairing that accidentally persists the raw
    // token: a leaked RefreshToken row would then be a live session for
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

  it('resolves a concurrent duplicate signup to exactly one 201 and one 409', async () => {
    // Two sequential calls (the test above) never actually contend: the
    // first always finishes before the second starts. It is the database's
    // unique index on email that serialises a genuine race, not the
    // service's try/catch by itself; this proves that holds under real
    // concurrency, the same pattern Stage 7's capacity guards will lean on.
    const email = `${uniq('race')}@uni.ac.ae`;
    const [a, b] = await Promise.all([signup(app, { email }), signup(app, { email })]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
  });

  it('rejects an 11-character password, one below the minimum', async () => {
    // Catches a `.min(11)` typo. The vaguer "some short password" version
    // of this test would not.
    const res = await signup(app, { password: 'a'.repeat(11) });
    expect(res.status).toBe(400);
  });

  it('accepts a 12-character password, exactly at the minimum', async () => {
    const res = await signup(app, { password: 'a'.repeat(12) });
    expect(res.status).toBe(201);
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

    // Catches a lookup that skips emailSchema's normalisation: it would
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

    // requestId is expected to differ per request, asserted so the two
    // toEqual bodies below aren't quietly comparing one response against
    // itself. A differing `detail` string between the two branches is the
    // usual shape of an account-enumeration bug, and comparing only status
    // would miss it entirely.
    const { requestId: unknownRequestId, ...unknownBody } = unknownEmailRes.body;
    const { requestId: wrongRequestId, ...wrongBody } = wrongPasswordRes.body;
    expect(unknownRequestId).not.toBe(wrongRequestId);
    expect(unknownBody).toEqual(wrongBody);
  });

  it('verifies against the dummy hash when no user is found: the dummy-hash branch actually runs', async () => {
    // Asserts the CODE PATH taken, not its wall-clock cost. A timing
    // assertion on two real HTTP round trips is load-sensitive: a GC pause
    // or a busy CI runner can violate it with nothing wrong, and it can pass
    // even with the dummy-hash branch deleted, as long as both paths happen
    // to be equally slow for some other reason. This is strictly more
    // discriminating: it fails the moment "no user, return immediately"
    // replaces the unconditional verify() call, regardless of timing.
    await login(app, { email: 'never-signed-up@uni.ac.ae', password: 'whatever-at-all' });

    expect(verify).toHaveBeenCalledWith(DUMMY_HASH, 'whatever-at-all');
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
    // Indistinguishable from an unknown email: the one deliberate exception
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
    const otherClub = await prisma.club.create({
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
    // A second, non-ACTIVE appointment in a DIFFERENT club. Without it, the
    // fixture only ever inserts ACTIVE rows, so deleting `buildSessionUser`'s
    // `status: 'ACTIVE'` filter entirely would still leave this test green:
    // there'd be nothing else in the table for the unfiltered query to
    // wrongly pick up.
    await prisma.clubTeamAppointment.create({
      data: { clubId: otherClub.id, userId, role: 'MARKETING', status: 'INVITED', invitedById: userId },
    });

    const res = await login(app, { email: 'lead@uni.ac.ae', password: 'correct-horse-battery' });

    // Catches a session-user builder that ignores appointments entirely, or
    // one that forgets the ACTIVE-only filter and would also surface a
    // DECLINED/INVITED appointment as live authority. `clubName` is asserted
    // against the club the appointment points at, with a second club in the
    // table holding a different name, so a builder that joins the wrong club
    // or echoes the first club it finds goes red.
    expect(res.body.clubRoles).toEqual([
      { clubId: club.id, clubName: club.name, role: 'LEAD' },
    ]);
  });

  it('writes no audit row for a routine login', async () => {
    await signup(app, { email: 'quiet@uni.ac.ae', password: 'correct-horse-battery' });
    await login(app, { email: 'quiet@uni.ac.ae', password: 'correct-horse-battery' });

    const count = await prisma.auditLog.count();
    expect(count).toBe(0);
  });

});

describe('loginAsAdmin test helper', () => {
  it('promotes the signed-up user so the same session cookie now carries admin authority', async () => {
    // Not an assertion about a product endpoint. This proves the Task 10+
    // helper itself does what its doc comment claims: the cookie minted at
    // signup keeps authenticating after the direct-write promotion, because
    // SessionGuard re-reads platformRole from the database every request.
    const { userId } = await loginAsAdmin(app, {});
    const row = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(row.platformRole).toBe('ADMIN');
  });
});
