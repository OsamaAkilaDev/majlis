import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { API_PREFIX } from '../src/config/api-prefix';
import { createTestApp } from './app';
import {
  loginAsAdmin,
  loginAsStudent,
  patchStatus,
  refresh,
  signupAndKeepCookies,
  suspendAsAdmin,
} from './auth-helpers';
import { createTestPrisma, disconnectTestPrisma, truncateAll } from './db';
import { makeActiveLead, makeActiveOfficer, makeClub, mkEvent, mkUser } from './factories';

const ME_PATH = `${API_PREFIX}/me`;
const USERS_PATH = `${API_PREFIX}/users`;

const prisma = createTestPrisma();
let app: INestApplication;

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

function get(path: string, cookie: string): request.Test {
  return request(app.getHttpServer()).get(path).set('Cookie', cookie);
}

describe('GET /me', () => {
  it("returns the caller's own profile, never a password hash", async () => {
    const me = await loginAsStudent(app);
    const res = await get(ME_PATH, me.sessionCookie);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(me.userId);
    expect(res.body.passwordHash).toBeUndefined();
  });
});

describe('PATCH /me', () => {
  it('ignores status, platformRole and email sent to PATCH /me', async () => {
    const me = await loginAsStudent(app);
    const res = await request(app.getHttpServer())
      .patch(ME_PATH)
      .set('Cookie', me.sessionCookie)
      .send({ fullName: 'New Name', platformRole: 'ADMIN', status: 'ACTIVE', email: 'x@y.z' });
    expect(res.status).toBe(200);

    const row = await prisma.user.findUniqueOrThrow({ where: { id: me.userId } });
    // Catches a service doing `data: body` rather than picking fields —
    // which would let any student make themselves an Admin with one PATCH.
    expect(row.fullName).toBe('New Name');
    expect(row.platformRole).toBe('STUDENT');
    expect(row.email).not.toBe('x@y.z');
  });

  it('updates avatarUrl without touching fullName when only avatarUrl is sent', async () => {
    // Catches an implementation that always writes both columns (e.g.
    // `data: { fullName: body.fullName, avatarUrl: body.avatarUrl }`
    // unconditionally) — that would null out fullName the moment a client
    // sends only avatarUrl, since an omitted key becomes `undefined`.
    const me = await loginAsStudent(app);
    const res = await request(app.getHttpServer())
      .patch(ME_PATH)
      .set('Cookie', me.sessionCookie)
      .send({ avatarUrl: 'https://example.test/a.png' });
    expect(res.status).toBe(200);

    const row = await prisma.user.findUniqueOrThrow({ where: { id: me.userId } });
    expect(row.avatarUrl).toBe('https://example.test/a.png');
    expect(row.fullName).toBe('Test Person');
  });
});

describe('GET /users', () => {
  it('lets a student reach /me but not /users', async () => {
    const me = await loginAsStudent(app);
    expect((await get(ME_PATH, me.sessionCookie)).status).toBe(200);
    expect((await get(USERS_PATH, me.sessionCookie)).status).toBe(403);
  });

  it('allows an ADMIN to list users', async () => {
    // A positive control: without it, a guard that denies every request
    // outright would still pass the test above.
    const admin = await loginAsAdmin(app);
    const res = await get(USERS_PATH, admin.sessionCookie);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.items)).toBe(true);
  });

  it('rejects a malformed cursor with 400, not 500', async () => {
    // Same P2023 gap as PATCH /users/{id}/status: `cursor: { id: query.cursor }`
    // against User.id's @db.Uuid column throws Prisma's P2023 for a
    // non-uuid string, which surfaced as a bare 500 before problem.filter.ts
    // mapped it.
    const admin = await loginAsAdmin(app);
    const res = await get(`${USERS_PATH}?cursor=not-a-uuid`, admin.sessionCookie);
    expect(res.status).toBe(400);
  });

  it('caps the user list however large a limit is asked for', async () => {
    const admin = await loginAsAdmin(app);
    const res = await get(`${USERS_PATH}?limit=100000`, admin.sessionCookie);
    // Catches a route wired to an unbounded query param instead of
    // cursorPageQuerySchema, whose max(100) is what makes "no unbounded
    // list, anywhere" a property of the contract rather than a habit.
    expect(res.status).toBe(400);
  });

  it('paginates forward across pages rather than repeating page one', async () => {
    // Filler rows created directly (mkUser), not through /auth/signup — a
    // dozen real signups in one test would trip the 3-per-hour throttle.
    const admin = await loginAsAdmin(app);
    for (let i = 0; i < 5; i++) await mkUser();

    const first = await get(`${USERS_PATH}?limit=2`, admin.sessionCookie);
    expect(first.status).toBe(200);
    expect(first.body.items).toHaveLength(2);
    expect(first.body.nextCursor).not.toBeNull();

    const second = await get(
      `${USERS_PATH}?limit=2&cursor=${first.body.nextCursor as string}`,
      admin.sessionCookie,
    );
    expect(second.status).toBe(200);
    expect(second.body.items).toHaveLength(2);

    // Catches a cursor param that's accepted but ignored (or a broken
    // `skip`/`cursor` pairing) — either would hand back the same rows a
    // second time instead of walking forward.
    const firstIds = (first.body.items as { id: string }[]).map((u) => u.id);
    const secondIds = (second.body.items as { id: string }[]).map((u) => u.id);
    expect(secondIds.some((id) => firstIds.includes(id))).toBe(false);
  });
});

describe('PATCH /users/{id}/status', () => {
  it('revokes every refresh token when a user is suspended', async () => {
    // The one most likely to ship broken: a suspension that only flips
    // `status` passes every other test in this file too, because
    // SessionGuard already blocks the suspended user's access token on the
    // very next request. It's the 30-day refresh token that would otherwise
    // spring back to life the moment the account is reinstated.
    const victim = await signupAndKeepCookies(app);
    const suspendRes = await suspendAsAdmin(app, victim.userId, 'policy violation');
    expect(suspendRes.status).toBe(200);

    expect((await refresh(app, victim.refreshCookie)).status).toBe(401);

    const rows = await prisma.refreshToken.findMany({ where: { userId: victim.userId } });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.revokedAt !== null)).toBe(true);
  });

  it('refuses to let an admin suspend themselves', async () => {
    const admin = await loginAsAdmin(app);
    const res = await patchStatus(app, admin.sessionCookie, admin.userId, 'SUSPENDED', 'why not');
    expect(res.status).toBe(422);
    expect(await prisma.user.findUniqueOrThrow({ where: { id: admin.userId } })).toMatchObject({
      status: 'ACTIVE',
    });
  });

  it('writes before/after snapshots, the reason, and the actor on the audit row', async () => {
    const admin = await loginAsAdmin(app);
    const victim = await loginAsStudent(app);

    await patchStatus(app, admin.sessionCookie, victim.userId, 'SUSPENDED', 'policy violation');

    const rows = await prisma.auditLog.findMany({ where: { entityId: victim.userId } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.action).toBe('user.suspended');
    expect(rows[0]?.before).toMatchObject({ status: 'ACTIVE' });
    expect(rows[0]?.after).toMatchObject({ status: 'SUSPENDED' });
    expect(rows[0]?.reason).toBe('policy violation');
    expect(rows[0]?.actorUserId).toBe(admin.userId);
  });

  it('rejects suspending an already-suspended account with 409, not a silent no-op', async () => {
    const admin = await loginAsAdmin(app);
    const victim = await loginAsStudent(app);
    await patchStatus(app, admin.sessionCookie, victim.userId, 'SUSPENDED', 'first');

    const again = await patchStatus(app, admin.sessionCookie, victim.userId, 'SUSPENDED', 'second');
    expect(again.status).toBe(409);

    // Catches an implementation with no before/after guard, which would
    // "succeed" a second time and write a second, misleading audit row for
    // an action that didn't actually change anything.
    expect(await prisma.auditLog.count({ where: { entityId: victim.userId } })).toBe(1);
  });

  it('reinstating does not need to revoke tokens again — suspension already revoked them all', async () => {
    const admin = await loginAsAdmin(app);
    const victim = await signupAndKeepCookies(app);

    await patchStatus(app, admin.sessionCookie, victim.userId, 'SUSPENDED', 'policy violation');
    const reinstate = await patchStatus(app, admin.sessionCookie, victim.userId, 'ACTIVE', 'appeal upheld');
    expect(reinstate.status).toBe(200);

    // The refresh token live at signup must stay dead: reinstatement issues
    // no new one, and must not resurrect the one suspension revoked.
    expect((await refresh(app, victim.refreshCookie)).status).toBe(401);
    expect(await prisma.user.findUniqueOrThrow({ where: { id: victim.userId } })).toMatchObject({
      status: 'ACTIVE',
    });
  });

  it('denies a non-admin outright, and the write does not happen', async () => {
    // permissions-guard.integration.test.ts already proves PermissionsGuard
    // itself against a stand-in controller; this re-asserts the same denial
    // against the real production route.
    const student = await loginAsStudent(app);
    const target = await loginAsStudent(app);

    const res = await patchStatus(app, student.sessionCookie, target.userId, 'SUSPENDED', 'nope');
    expect(res.status).toBe(403);
    expect(await prisma.user.findUniqueOrThrow({ where: { id: target.userId } })).toMatchObject({
      status: 'ACTIVE',
    });
  });

  it('serialises two concurrent suspends of the same account to one 200 and one 409', async () => {
    // Catches a plain `findUnique` (no lock): both requests would read
    // ACTIVE, both pass the "already in that state" guard, and both commit
    // — two 200s and two user.suspended audit rows for one transition,
    // instead of the second one correctly seeing the first's write and
    // bouncing off the 409 guard.
    const admin = await loginAsAdmin(app);
    const victim = await loginAsStudent(app);

    const [a, b] = await Promise.all([
      patchStatus(app, admin.sessionCookie, victim.userId, 'SUSPENDED', 'first'),
      patchStatus(app, admin.sessionCookie, victim.userId, 'SUSPENDED', 'second'),
    ]);

    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(await prisma.auditLog.count({ where: { entityId: victim.userId, action: 'user.suspended' } })).toBe(
      1,
    );
  });

  it('rejects a malformed id with 400, not 500', async () => {
    // Catches the pre-fix gap: User.id is @db.Uuid, and a plain findUnique
    // against a non-uuid string throws Prisma's P2023, which problem.filter.ts
    // did not map — surfacing as a bare 500 instead of a client error.
    const admin = await loginAsAdmin(app);
    const res = await patchStatus(app, admin.sessionCookie, 'not-a-uuid', 'SUSPENDED', 'x');
    expect(res.status).toBe(400);
  });

  it('still 404s a well-formed but unknown id', async () => {
    const admin = await loginAsAdmin(app);
    const res = await patchStatus(
      app,
      admin.sessionCookie,
      '00000000-0000-7000-8000-000000000000',
      'SUSPENDED',
      'x',
    );
    expect(res.status).toBe(404);
  });
});

describe('GET /clubs/:clubId/user-search', () => {
  function search(cookie: string, clubId: string, q: string): request.Test {
    return request(app.getHttpServer())
      .get(`${API_PREFIX}/clubs/${clubId}/user-search`)
      .query({ q })
      .set('Cookie', cookie);
  }

  it('lets a club Lead find somebody by name, and returns three columns', async () => {
    const club = await makeClub();
    const lead = await makeActiveLead(app, club.id);
    const target = await mkUser({ fullName: 'Mariam Al Zaabi' });

    const res = await search(lead.sessionCookie, club.id, 'zaabi');

    expect(res.status).toBe(200);
    const found = res.body.items.find((u: { id: string }) => u.id === target.id);
    expect(found).toBeDefined();
    // A club Lead has no business reading platform role, account status or
    // creation date for every account in the university. GET /users returns
    // all three and stays Admin-only; this route is why it can.
    expect(Object.keys(found).sort()).toEqual(['email', 'fullName', 'id']);
  });

  it('matches on email too, which is how an officer with an address finds a person', async () => {
    const club = await makeClub();
    const lead = await makeActiveLead(app, club.id);
    const target = await mkUser({ email: 'findme.by.address@uni.ac.ae', fullName: 'Nothing Like It' });
    await mkUser({ fullName: 'Another Person' });

    const res = await search(lead.sessionCookie, club.id, 'findme.by.address');

    expect(res.status).toBe(200);
    // Exactly the one match, not the whole directory: a search that ignored
    // `q` and returned everyone would satisfy a "contains the target" test.
    expect(res.body.items.map((u: { id: string }) => u.id)).toEqual([target.id]);
  });

  it('refuses a club Marketing officer, who holds no user:search rule', async () => {
    const club = await makeClub();
    const marketing = await makeActiveOfficer(app, club.id, 'MARKETING');
    await mkUser({ fullName: 'Mariam Al Zaabi' });

    const res = await search(marketing.sessionCookie, club.id, 'zaabi');

    expect(res.status).toBe(403);
    expect(res.body.detail).toBe('You do not have permission to do that.');
  });

  it('refuses an officer of a DIFFERENT club, since the rule is club-scoped', async () => {
    // Catches a rule that reached the platform column only, or a guard
    // resolving roles against something other than the clubId in the path:
    // a Lead anywhere would then search from any club's id.
    const club = await makeClub();
    const elsewhere = await makeClub();
    const lead = await makeActiveLead(app, elsewhere.id);

    const res = await search(lead.sessionCookie, club.id, 'zaabi');

    expect(res.status).toBe(403);
    expect(res.body.detail).toBe('You do not have permission to do that.');
  });

  it('refuses a one-character query rather than dumping the directory', async () => {
    const club = await makeClub();
    const lead = await makeActiveLead(app, club.id);

    expect((await search(lead.sessionCookie, club.id, 'z')).status).toBe(400);
    expect(
      (await request(app.getHttpServer())
        .get(`${API_PREFIX}/clubs/${club.id}/user-search`)
        .set('Cookie', lead.sessionCookie)).status,
    ).toBe(400);
  });

  it('carries a club Lead all the way through an event assignment', async () => {
    // The flow this route exists for. Before it, the picker called
    // GET /users, a Lead got a 403, the list rendered empty and nobody
    // could be assigned — which put Stage 6's whole EventAssignment scan
    // path out of reach of everyone but an Admin.
    const club = await makeClub();
    const lead = await makeActiveLead(app, club.id);
    const operator = await mkUser({ fullName: 'Yousef Operations' });
    const event = await mkEvent(club.id, lead.userId, { status: 'PUBLISHED' });

    const found = await search(lead.sessionCookie, club.id, 'Yousef');
    expect(found.status).toBe(200);
    const picked = found.body.items.find((u: { id: string }) => u.id === operator.id);
    expect(picked).toBeDefined();

    const assigned = await request(app.getHttpServer())
      .post(`${API_PREFIX}/events/${event.id}/assignments`)
      .set('Cookie', lead.sessionCookie)
      .send({ userId: picked.id, responsibility: 'OPERATIONS' });

    expect(assigned.status).toBe(201);
    expect(
      await prisma.eventAssignment.count({ where: { eventId: event.id, userId: operator.id } }),
    ).toBe(1);
  });
});
