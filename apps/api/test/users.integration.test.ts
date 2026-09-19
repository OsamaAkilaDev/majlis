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
    // Catches `data: body` instead of picked fields: a student could self-promote to Admin.
    expect(row.fullName).toBe('New Name');
    expect(row.platformRole).toBe('STUDENT');
    expect(row.email).not.toBe('x@y.z');
  });

  it('updates avatarUrl without touching fullName when only avatarUrl is sent', async () => {
    // Catches an update that writes both columns unconditionally, nulling fullName
    // when only avatarUrl is sent.
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
    // Positive control: a guard that denies everything would pass the test above.
    const admin = await loginAsAdmin(app);
    const res = await get(USERS_PATH, admin.sessionCookie);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.items)).toBe(true);
  });

  it('rejects a malformed cursor with 400, not 500', async () => {
    // Catches an unmapped P2023: a non-uuid cursor against User.id @db.Uuid
    // surfaced as a bare 500 before problem.filter.ts mapped it.
    const admin = await loginAsAdmin(app);
    const res = await get(`${USERS_PATH}?cursor=not-a-uuid`, admin.sessionCookie);
    expect(res.status).toBe(400);
  });

  it('caps the user list however large a limit is asked for', async () => {
    const admin = await loginAsAdmin(app);
    const res = await get(`${USERS_PATH}?limit=100000`, admin.sessionCookie);
    // Catches a route wired to an unbounded query param instead of
    // cursorPageQuerySchema, whose max(100) is what forbids unbounded lists.
    expect(res.status).toBe(400);
  });

  it('paginates forward across pages rather than repeating page one', async () => {
    // Filler rows via mkUser, not /auth/signup: real signups trip the 3-per-hour throttle.
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

    // Catches a cursor accepted but ignored, or a broken skip/cursor pairing:
    // either hands back page one twice.
    const firstIds = (first.body.items as { id: string }[]).map((u) => u.id);
    const secondIds = (second.body.items as { id: string }[]).map((u) => u.id);
    expect(secondIds.some((id) => firstIds.includes(id))).toBe(false);
  });

  it('matches q against the address as well as the name', async () => {
    // Three rows so each half of the OR is exercised: `zahra` in one name only,
    // one address only, and a decoy with neither. A one-sided `contains` fails,
    // and so does a query that drops the filter.
    const admin = await loginAsAdmin(app);
    const byName = await mkUser({ fullName: 'Zahra Al Marzouqi', email: 'sm7781@uni.ac.ae' });
    const byEmail = await mkUser({ fullName: 'Noura Al Blooshi', email: 'zahra.b@uni.ac.ae' });
    const decoy = await mkUser({ fullName: 'Omar Haddad', email: 'oh2200@uni.ac.ae' });

    const res = await get(`${USERS_PATH}?q=zahra`, admin.sessionCookie);
    expect(res.status).toBe(200);

    const ids = (res.body.items as { id: string }[]).map((u) => u.id);
    expect(ids).toContain(byName.id);
    expect(ids).toContain(byEmail.id);
    expect(ids).not.toContain(decoy.id);
  });

  it('matches q without regard to case', async () => {
    // Catches a `contains` missing `mode: 'insensitive'`: Postgres LIKE is
    // case-sensitive, so it passes every lowercase test above and finds nobody here.
    const admin = await loginAsAdmin(app);
    const user = await mkUser({ fullName: 'Zahra Al Marzouqi', email: 'sm7781@uni.ac.ae' });

    const res = await get(`${USERS_PATH}?q=ZAHRA`, admin.sessionCookie);
    expect(res.status).toBe(200);
    expect((res.body.items as { id: string }[]).map((u) => u.id)).toContain(user.id);
  });

  it('filters by status, returning neither everybody nor nobody', async () => {
    const admin = await loginAsAdmin(app);
    const active = await mkUser({ status: 'ACTIVE' });
    const suspended = await mkUser({ status: 'SUSPENDED' });

    const res = await get(`${USERS_PATH}?status=SUSPENDED`, admin.sessionCookie);
    expect(res.status).toBe(200);

    const ids = (res.body.items as { id: string }[]).map((u) => u.id);
    // First assertion fails an over-narrow filter, second an ignored one. The
    // signed-in admin is ACTIVE, so an ignored filter always shows here.
    expect(ids).toContain(suspended.id);
    expect(ids).not.toContain(active.id);
  });

  it('rejects an unknown status rather than ignoring it', async () => {
    const admin = await loginAsAdmin(app);
    expect((await get(`${USERS_PATH}?status=DELETED`, admin.sessionCookie)).status).toBe(400);
  });
});

describe('PATCH /users/{id}/status', () => {
  it('revokes every refresh token when a user is suspended', async () => {
    // Catches a suspension that only flips `status`: SessionGuard blocks the access
    // token anyway, so every other test passes, but the 30-day refresh token springs
    // back to life on reinstatement.
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

    // Catches a missing before/after guard, which writes a second audit row
    // for a transition that changed nothing.
    expect(await prisma.auditLog.count({ where: { entityId: victim.userId } })).toBe(1);
  });

  it('reinstating does not need to revoke tokens again: suspension already revoked them all', async () => {
    const admin = await loginAsAdmin(app);
    const victim = await signupAndKeepCookies(app);

    await patchStatus(app, admin.sessionCookie, victim.userId, 'SUSPENDED', 'policy violation');
    const reinstate = await patchStatus(app, admin.sessionCookie, victim.userId, 'ACTIVE', 'appeal upheld');
    expect(reinstate.status).toBe(200);

    // Catches reinstatement un-revoking tokens: the signup refresh token must stay dead.
    expect((await refresh(app, victim.refreshCookie)).status).toBe(401);
    expect(await prisma.user.findUniqueOrThrow({ where: { id: victim.userId } })).toMatchObject({
      status: 'ACTIVE',
    });
  });

  it('denies a non-admin outright, and the write does not happen', async () => {
    // permissions-guard proves the guard against a stand-in controller; this
    // re-asserts the denial on the real route.
    const student = await loginAsStudent(app);
    const target = await loginAsStudent(app);

    const res = await patchStatus(app, student.sessionCookie, target.userId, 'SUSPENDED', 'nope');
    expect(res.status).toBe(403);
    expect(await prisma.user.findUniqueOrThrow({ where: { id: target.userId } })).toMatchObject({
      status: 'ACTIVE',
    });
  });

  it('serialises two concurrent suspends of the same account to one 200 and one 409', async () => {
    // Promise.all forces the race. Catches a plain findUnique with no row lock:
    // both read ACTIVE, both commit, two 200s and two audit rows for one transition.
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
    // Catches an unmapped P2023: findUnique on User.id @db.Uuid with a non-uuid
    // string surfaced as a bare 500.
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
    // Catches a Lead-reachable route leaking platform role, status or creation
    // date. GET /users returns all three and stays Admin-only.
    expect(Object.keys(found).sort()).toEqual(['email', 'fullName', 'id']);
  });

  it('matches on email too, which is how an officer with an address finds a person', async () => {
    const club = await makeClub();
    const lead = await makeActiveLead(app, club.id);
    const target = await mkUser({ email: 'findme.by.address@uni.ac.ae', fullName: 'Nothing Like It' });
    await mkUser({ fullName: 'Another Person' });

    const res = await search(lead.sessionCookie, club.id, 'findme.by.address');

    expect(res.status).toBe(200);
    // Exactly one match, not the directory: a search ignoring `q` would satisfy
    // a "contains the target" assertion.
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
    // Catches a guard resolving roles against something other than the path clubId:
    // a Lead anywhere could then search from any club's id.
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
    // End-to-end control: the picker previously called GET /users, a Lead got 403
    // and no assignment was possible.
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

describe('PATCH /users/{id}', () => {
  function patchUser(id: string, cookie: string, body: Record<string, unknown>) {
    return request(app.getHttpServer())
      .patch(`${USERS_PATH}/${id}`)
      .set('Cookie', cookie)
      .send(body);
  }

  it('refuses a student, who may edit only themselves through /me', async () => {
    const me = await loginAsStudent(app);
    const other = await mkUser();
    expect((await patchUser(other.id, me.sessionCookie, { fullName: 'X', reason: 'r' })).status).toBe(403);
  });

  it('edits name, email, avatar and role in one call', async () => {
    const admin = await loginAsAdmin(app);
    const target = await mkUser({ fullName: 'Old Name', email: 'old@uni.ac.ae' });

    const res = await patchUser(target.id, admin.sessionCookie, {
      fullName: 'New Name',
      email: 'New@Uni.ac.ae',
      avatarUrl: 'https://cdn.uni.ac.ae/a.png',
      platformRole: 'ADMIN',
      reason: 'Registry correction',
    });

    expect(res.status).toBe(200);
    expect(res.body.fullName).toBe('New Name');
    // Lowercased by emailSchema; the column has CHECK (email = lower(email)), so
    // writing the raw string is a 500.
    expect(res.body.email).toBe('new@uni.ac.ae');
    expect(res.body.avatarUrl).toBe('https://cdn.uni.ac.ae/a.png');
    expect(res.body.platformRole).toBe('ADMIN');
    // Never the hash, on any response carrying a user.
    expect(res.body.passwordHash).toBeUndefined();
  });

  it('leaves untouched fields alone rather than nulling them', async () => {
    // Catches an update built from the whole body, nulling every field the admin
    // did not type.
    const admin = await loginAsAdmin(app);
    const target = await mkUser({ fullName: 'Keep Me', email: 'keep@uni.ac.ae' });

    const res = await patchUser(target.id, admin.sessionCookie, { fullName: 'Renamed', reason: 'r' });
    expect(res.status).toBe(200);
    expect(res.body.email).toBe('keep@uni.ac.ae');
    expect(res.body.platformRole).toBe('STUDENT');
  });

  it('refuses an email already held by another account', async () => {
    const admin = await loginAsAdmin(app);
    await mkUser({ email: 'taken@uni.ac.ae' });
    const target = await mkUser({ email: 'free@uni.ac.ae' });

    const res = await patchUser(target.id, admin.sessionCookie, {
      email: 'taken@uni.ac.ae',
      reason: 'r',
    });
    // Catches an unhandled P2002, which surfaces as a bare 500.
    expect(res.status).toBe(409);
  });

  it('revokes the target live refresh tokens when their email changes', async () => {
    // The address is the sign-in credential: repointing it must not leave a live
    // 30-day session on the old one.
    const admin = await loginAsAdmin(app);
    const victim = await signupAndKeepCookies(app, { email: 'victim@uni.ac.ae' });

    expect((await refresh(app, victim.refreshCookie)).status).toBe(200);

    const res = await patchUser(victim.userId, admin.sessionCookie, {
      email: 'moved@uni.ac.ae',
      reason: 'r',
    });
    expect(res.status).toBe(200);
    expect((await refresh(app, victim.refreshCookie)).status).toBe(401);
  });

  it('refuses an admin changing their own platform role', async () => {
    // Catches a self-demotion guard fitted only to the /status route.
    const admin = await loginAsAdmin(app);
    const res = await patchUser(admin.userId, admin.sessionCookie, {
      platformRole: 'STUDENT',
      reason: 'r',
    });
    expect(res.status).toBe(422);
  });

  it('lets an admin edit their own name, which is not a privilege', async () => {
    // Positive control for the guard above: "no self edits at all" passes that
    // test and fails this one.
    const admin = await loginAsAdmin(app);
    const res = await patchUser(admin.userId, admin.sessionCookie, {
      fullName: 'Renamed Admin',
      reason: 'r',
    });
    expect(res.status).toBe(200);
    expect(res.body.fullName).toBe('Renamed Admin');
  });

  it('demotes another admin while a second one remains', async () => {
    const admin = await loginAsAdmin(app);
    const second = await mkUser({ platformRole: 'ADMIN' });

    const res = await patchUser(second.id, admin.sessionCookie, {
      platformRole: 'STUDENT',
      reason: 'r',
    });
    expect(res.status).toBe(200);
    expect(res.body.platformRole).toBe('STUDENT');
  });

  it('never lets two admins demote each other down to none', async () => {
    // Promise.all forces the race: sequentially the self-role guard already keeps
    // one admin, so only concurrency reaches zero, and zero admins has no route
    // back (/auth/bootstrap shuts once the first admin exists). Catches a plain
    // count outside the lock.
    const a = await loginAsAdmin(app, { email: 'admin.a@uni.ac.ae' });
    const b = await loginAsAdmin(app, { email: 'admin.b@uni.ac.ae' });

    const [ab, ba] = await Promise.all([
      patchUser(b.userId, a.sessionCookie, { platformRole: 'STUDENT', reason: 'r' }),
      patchUser(a.userId, b.sessionCookie, { platformRole: 'STUDENT', reason: 'r' }),
    ]);

    const admins = await prisma.user.count({ where: { platformRole: 'ADMIN' } });
    expect(admins).toBeGreaterThanOrEqual(1);
    // Exactly one wins, whichever gate answered first.
    expect([ab.status, ba.status].filter((s) => s === 200)).toHaveLength(1);
  });

  it('refuses a patch carrying nothing but a reason', async () => {
    const admin = await loginAsAdmin(app);
    const target = await mkUser();
    expect((await patchUser(target.id, admin.sessionCookie, { reason: 'r' })).status).toBe(422);
  });

  it('requires a reason', async () => {
    const admin = await loginAsAdmin(app);
    const target = await mkUser();
    expect((await patchUser(target.id, admin.sessionCookie, { fullName: 'X' })).status).toBe(400);
  });

  it('refuses an avatar URL that is not https', async () => {
    const admin = await loginAsAdmin(app);
    const target = await mkUser();
    const res = await patchUser(target.id, admin.sessionCookie, {
      avatarUrl: 'javascript:alert(1)',
      reason: 'r',
    });
    expect(res.status).toBe(400);
  });

  it('answers 404 for a well-formed id that matches nobody', async () => {
    const admin = await loginAsAdmin(app);
    const res = await patchUser('0199a0a0-0000-7000-8000-000000000000', admin.sessionCookie, {
      fullName: 'X',
      reason: 'r',
    });
    expect(res.status).toBe(404);
  });

  it('writes one audit row carrying the reason and the role change', async () => {
    const admin = await loginAsAdmin(app);
    const target = await mkUser({ platformRole: 'STUDENT' });

    await patchUser(target.id, admin.sessionCookie, {
      platformRole: 'ADMIN',
      reason: 'Appointed registrar',
    }).expect(200);

    const rows = await prisma.auditLog.findMany({ where: { entityId: target.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.action).toBe('user.role_changed');
    expect(rows[0]!.reason).toBe('Appointed registrar');
    expect(rows[0]!.actorUserId).toBe(admin.userId);
    // before/after carry the transition, so the log reads without a join.
    expect(rows[0]!.before).toMatchObject({ platformRole: 'STUDENT' });
    expect(rows[0]!.after).toMatchObject({ platformRole: 'ADMIN' });
  });
});

describe('the platform can never lose its last usable admin', () => {
  function patchUser(id: string, cookie: string, body: Record<string, unknown>) {
    return request(app.getHttpServer())
      .patch(`${USERS_PATH}/${id}`)
      .set('Cookie', cookie)
      .send(body);
  }

  function patchUserStatus(id: string, cookie: string, body: Record<string, unknown>) {
    return request(app.getHttpServer())
      .patch(`${USERS_PATH}/${id}/status`)
      .set('Cookie', cookie)
      .send(body);
  }

  it('refuses a self role change sent with an upper-cased id', async () => {
    // Postgres compares uuid case-insensitively and UUID_SHAPE carries /i, so an
    // upper-cased id still reaches the caller's row. Catches a self guard written
    // as `actor.id === targetId`, which demotes the caller.
    const admin = await loginAsAdmin(app);
    const shouty = admin.userId.toUpperCase();
    expect(shouty).not.toBe(admin.userId);

    const res = await patchUser(shouty, admin.sessionCookie, {
      platformRole: 'STUDENT',
      reason: 'r',
    });
    expect(res.status).toBe(422);

    const row = await prisma.user.findUniqueOrThrow({ where: { id: admin.userId } });
    expect(row.platformRole).toBe('ADMIN');
  });

  it('refuses a self status change sent with an upper-cased id', async () => {
    const admin = await loginAsAdmin(app);
    const res = await patchUserStatus(admin.userId.toUpperCase(), admin.sessionCookie, {
      status: 'SUSPENDED',
      reason: 'r',
    });
    expect(res.status).toBe(422);
  });

  it('does not count a suspended admin as one who could still sign in', async () => {
    // Catches a last-admin count filtered on role alone: suspended admins cannot
    // sign in, so it reads two here and lets the only usable admin be demoted.
    const admin = await loginAsAdmin(app);
    const other = await loginAsAdmin(app, { email: 'second.admin@uni.ac.ae' });

    await patchUserStatus(other.userId, admin.sessionCookie, {
      status: 'SUSPENDED',
      reason: 'r',
    }).expect(200);

    // `admin` is now the only ACTIVE admin, but other admin rows exist, so a
    // role-only count waves this through.
    const third = await loginAsAdmin(app, { email: 'third.admin@uni.ac.ae' });
    await patchUserStatus(third.userId, admin.sessionCookie, {
      status: 'SUSPENDED',
      reason: 'r',
    }).expect(200);

    const demote = await patchUser(admin.userId, third.sessionCookie, {
      platformRole: 'STUDENT',
      reason: 'r',
    });
    // third is suspended, so SessionGuard refuses them outright.
    expect(demote.status).toBe(401);

    const active = await prisma.user.count({
      where: { platformRole: 'ADMIN', status: 'ACTIVE' },
    });
    expect(active).toBeGreaterThanOrEqual(1);
  });

  it('never lets two admins suspend each other down to none', async () => {
    // Suspension reaches zero admins the same way demotion does, so Promise.all
    // forces the same race: both read two active admins before either commits.
    const a = await loginAsAdmin(app, { email: 'susp.a@uni.ac.ae' });
    const b = await loginAsAdmin(app, { email: 'susp.b@uni.ac.ae' });

    const [ab, ba] = await Promise.all([
      patchUserStatus(b.userId, a.sessionCookie, { status: 'SUSPENDED', reason: 'r' }),
      patchUserStatus(a.userId, b.sessionCookie, { status: 'SUSPENDED', reason: 'r' }),
    ]);

    const active = await prisma.user.count({
      where: { platformRole: 'ADMIN', status: 'ACTIVE' },
    });
    expect(active).toBeGreaterThanOrEqual(1);
    expect([ab.status, ba.status].filter((s) => s === 200)).toHaveLength(1);
  });

  it('ends live sessions, not just refresh tokens, when an email changes', async () => {
    // Catches revoking the refresh token alone: the access token in the browser
    // stays valid for its remaining 15 minutes unless sessionsInvalidatedAt moves.
    const admin = await loginAsAdmin(app);
    const victim = await loginAsStudent(app, { email: 'session.victim@uni.ac.ae' });

    expect((await get(ME_PATH, victim.sessionCookie)).status).toBe(200);

    await patchUser(victim.userId, admin.sessionCookie, {
      email: 'session.moved@uni.ac.ae',
      reason: 'r',
    }).expect(200);

    expect((await get(ME_PATH, victim.sessionCookie)).status).toBe(401);
  });
});
