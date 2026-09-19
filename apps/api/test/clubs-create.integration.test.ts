import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { API_PREFIX } from '../src/config/api-prefix';
import { StorageService } from '../src/storage/storage.service';
import { createTestApp } from './app';
import { loginAsAdmin, loginAsStudent } from './auth-helpers';
import { createTestPrisma, disconnectTestPrisma, truncateAll } from './db';
import {
  aDepartment,
  inviteOfficer,
  makeActiveLead,
  makeClub,
  mkEvent,
  mkUser,
  uniq,
} from './factories';

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
const in7Days = (plusHours = 0) => new Date(Date.now() + 7 * DAY + plusHours * HOUR);
const daysAgo = (days: number, plusHours = 0) => new Date(Date.now() - days * DAY + plusHours * HOUR);

const CLUBS_PATH = `${API_PREFIX}/clubs`;
const UPLOAD_PATH = `${API_PREFIX}/uploads/club-logo`;

const prisma = createTestPrisma();
let app: INestApplication;

/** What the fake storage backend has "received" bytes for, keyed by object path. */
const uploaded = new Map<string, { size: number; contentType: string }>();

// Stubbed at the module level so no test in this file touches Supabase.
const fakeStorage = {
  createSignedUploadUrl: async (path: string) => ({
    signedUrl: `https://example.supabase.co/storage/v1/object/upload/sign/majlis-storage/${path}?token=t`,
    token: 't',
  }),
  statObject: async (path: string) => uploaded.get(path) ?? null,
  publicUrlFor: (path: string, version: number) =>
    `https://example.supabase.co/storage/v1/object/public/majlis-storage/${path}?v=${version}`,
};

beforeAll(async () => {
  app = await createTestApp([], [{ provide: StorageService, useValue: fakeStorage }]);
});

afterAll(async () => {
  await app.close();
  await disconnectTestPrisma(prisma);
});

beforeEach(async () => {
  await truncateAll(prisma);
  uploaded.clear();
});

/** A valid create body missing only clubId, which every test mints first. No logoUrl: the server derives it. */
function validBody(departmentId: string) {
  return {
    departmentId,
    name: uniq('Club'),
    description: 'We build robots.',
    category: 'Technology',
    academicYear: '2026/2027',
    membershipPolicy: 'OPEN' as const,
  };
}

describe('POST /uploads/club-logo then POST /clubs', () => {
  it('mints an id, then creates the club at that id', async () => {
    const admin = await loginAsAdmin(app);
    const dept = await prisma.department.create({ data: aDepartment() });

    const minted = await request(app.getHttpServer()).post(UPLOAD_PATH).set('Cookie', admin.sessionCookie);
    expect(minted.status).toBe(201);

    const { clubId, path } = minted.body;
    expect(path).toBe(`clubs/${clubId}/logo.webp`);
    uploaded.set(path, { size: 1000, contentType: 'image/webp' });

    const res = await request(app.getHttpServer())
      .post(CLUBS_PATH)
      .set('Cookie', admin.sessionCookie)
      .send({ ...validBody(dept.id), name: 'Robotics Club', clubId });

    expect(res.status).toBe(201);
    expect(res.body.id).toBe(clubId);
    expect(res.body.slug).toBe('robotics-club');
  });

  it('refuses to create a club whose logo was never uploaded', async () => {
    // The API never sees the bytes, so without verification a client creates a
    // club whose logo points at nothing and every screen renders broken.
    const admin = await loginAsAdmin(app);
    const dept = await prisma.department.create({ data: aDepartment() });
    const minted = await request(app.getHttpServer()).post(UPLOAD_PATH).set('Cookie', admin.sessionCookie);
    // `uploaded` is deliberately left empty.

    const res = await request(app.getHttpServer())
      .post(CLUBS_PATH)
      .set('Cookie', admin.sessionCookie)
      .send({ ...validBody(dept.id), clubId: minted.body.clubId });

    expect(res.status).toBe(422);
    expect(await prisma.club.count()).toBe(0);
  });

  it('refuses an uploaded object that is over the kind cap', async () => {
    // Catches verification checking existence but not size: the bucket limit is
    // 2 MB and the logo cap 256 KB, so a 1 MB object clears the bucket.
    const admin = await loginAsAdmin(app);
    const dept = await prisma.department.create({ data: aDepartment() });
    const minted = await request(app.getHttpServer()).post(UPLOAD_PATH).set('Cookie', admin.sessionCookie);
    uploaded.set(minted.body.path, { size: 1_000_000, contentType: 'image/webp' });

    const res = await request(app.getHttpServer())
      .post(CLUBS_PATH)
      .set('Cookie', admin.sessionCookie)
      .send({ ...validBody(dept.id), clubId: minted.body.clubId });

    expect(res.status).toBe(422);
    expect(await prisma.club.count()).toBe(0);
  });

  it('refuses an uploaded object that is not WebP', async () => {
    const admin = await loginAsAdmin(app);
    const dept = await prisma.department.create({ data: aDepartment() });
    const minted = await request(app.getHttpServer()).post(UPLOAD_PATH).set('Cookie', admin.sessionCookie);
    uploaded.set(minted.body.path, { size: 1000, contentType: 'image/png' });

    const res = await request(app.getHttpServer())
      .post(CLUBS_PATH)
      .set('Cookie', admin.sessionCookie)
      .send({ ...validBody(dept.id), clubId: minted.body.clubId });

    expect(res.status).toBe(422);
    expect(await prisma.club.count()).toBe(0);
  });

  it('suffixes the slug when two clubs share a name', async () => {
    const admin = await loginAsAdmin(app);
    const dept = await prisma.department.create({ data: aDepartment() });
    const create = async (name: string) => {
      const minted = await request(app.getHttpServer()).post(UPLOAD_PATH).set('Cookie', admin.sessionCookie);
      uploaded.set(minted.body.path, { size: 1000, contentType: 'image/webp' });
      return request(app.getHttpServer())
        .post(CLUBS_PATH)
        .set('Cookie', admin.sessionCookie)
        .send({ ...validBody(dept.id), name, clubId: minted.body.clubId });
    };

    expect((await create('Robotics Club')).body.slug).toBe('robotics-club');
    // uniqueSlug's pre-check already moved the second slug to -2, so the only
    // constraint left to fail here is the unique name.
    const collision = await create('Robotics Club');
    expect(collision.status).toBe(409);
    // The Problem Details filter maps an escaping P2002 to a generic 409 too, so
    // status alone passes with mapWriteError not matching this constraint. The
    // detail proves it fired and picked the name branch.
    expect(collision.body.detail).toBe('A club with that name already exists.');
    expect((await create('Robotics  Club!')).body.slug).toBe('robotics-club-2');
  });

  it('refuses a STUDENT', async () => {
    const student = await loginAsStudent(app);
    expect(
      (await request(app.getHttpServer()).post(UPLOAD_PATH).set('Cookie', student.sessionCookie)).status,
    ).toBe(403);
  });

  it('refuses a STUDENT on POST /clubs itself, and no club is created', async () => {
    // Both routes carry club:create, but the test above covers only the upload
    // route. Catches the guard missing from `create` itself.
    const student = await loginAsStudent(app);
    const dept = await prisma.department.create({ data: aDepartment() });

    const res = await request(app.getHttpServer())
      .post(CLUBS_PATH)
      .set('Cookie', student.sessionCookie)
      .send({ ...validBody(dept.id), clubId: '01936c7e-0000-7000-8000-000000000099' });

    expect(res.status).toBe(403);
    expect(await prisma.club.count()).toBe(0);
  });
});

describe('GET /clubs', () => {
  it('filters by department', async () => {
    const student = await loginAsStudent(app);
    const a = await prisma.department.create({ data: aDepartment() });
    await makeClub({ departmentId: a.id });
    await makeClub({ status: 'ARCHIVED' });

    const res = await request(app.getHttpServer())
      .get(`${CLUBS_PATH}?departmentId=${a.id}`)
      .set('Cookie', student.sessionCookie);

    // Catches a filter built but never applied, which returns everything and
    // still looks correct in a one-club fixture.
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].departmentName).toBe(a.name);
  });

  it('filters by status for an Admin, holding department constant', async () => {
    // The two fixtures differ ONLY in status: varying department too would let an
    // implementation that ignores `status` pass.
    const admin = await loginAsAdmin(app);
    const dept = await prisma.department.create({ data: aDepartment() });
    const archived = await makeClub({ departmentId: dept.id, status: 'ARCHIVED' });
    await makeClub({ departmentId: dept.id });

    const res = await request(app.getHttpServer())
      .get(`${CLUBS_PATH}?status=ARCHIVED`)
      .set('Cookie', admin.sessionCookie);

    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].id).toBe(archived.id);
  });

  it('gives a student ACTIVE clubs only, whatever status they ask for', async () => {
    // Catches the filter being the only thing that hid a suspended club: before
    // the gate, asking for SUSPENDED returned it to anyone.
    const student = await loginAsStudent(app);
    const dept = await prisma.department.create({ data: aDepartment() });
    await makeClub({ departmentId: dept.id, status: 'SUSPENDED' });
    const active = await makeClub({ departmentId: dept.id });

    const res = await request(app.getHttpServer())
      .get(`${CLUBS_PATH}?departmentId=${dept.id}&status=SUSPENDED`)
      .set('Cookie', student.sessionCookie);

    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].id).toBe(active.id);
  });

  it('filters by name, case-insensitively', async () => {
    // Catches a `q` filter never applied, and a case-sensitive `contains`.
    const student = await loginAsStudent(app);
    const dept = await prisma.department.create({ data: aDepartment() });
    const target = await makeClub({ departmentId: dept.id, name: uniq('Robotics Society') });
    await makeClub({ departmentId: dept.id, name: uniq('Chess Club') });

    const res = await request(app.getHttpServer())
      .get(`${CLUBS_PATH}?q=ROBOTICS`)
      .set('Cookie', student.sessionCookie);

    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].id).toBe(target.id);
  });

  it('caps limit at MAX_PAGE_LIMIT', async () => {
    const student = await loginAsStudent(app);
    expect(
      (await request(app.getHttpServer()).get(`${CLUBS_PATH}?limit=5000`).set('Cookie', student.sessionCookie))
        .status,
    ).toBe(400);
  });
});

describe('GET /clubs/:clubId', () => {
  it('reports the viewer own membership status and roles, never another user', async () => {
    const student = await loginAsStudent(app);
    const other = await loginAsStudent(app);
    const club = await makeClub();
    await prisma.clubMembership.create({
      data: { clubId: club.id, userId: other.userId, status: 'ACTIVE' },
    });

    const res = await request(app.getHttpServer())
      .get(`${CLUBS_PATH}/${club.id}`)
      .set('Cookie', student.sessionCookie);

    // Catches a findFirst with no userId filter, which returns whichever row
    // comes first and tells this student they are a member already.
    expect(res.body.viewerMembershipStatus).toBeNull();
    expect(res.body.memberCount).toBe(1);
  });

  it('carries the club own events, and never a draft', async () => {
    // A club page shows what the club is. The draft is the discriminator: an
    // implementation that just listed the club's events would leak it to every
    // student holding the slug.
    const lead = await loginAsStudent(app);
    const club = await makeClub();
    const soon = await mkEvent(club.id, lead.userId, { startsAt: in7Days(), endsAt: in7Days(2) });
    await mkEvent(club.id, lead.userId, { status: 'DRAFT', startsAt: in7Days(), endsAt: in7Days(2) });
    const ran = await mkEvent(club.id, lead.userId, {
      status: 'COMPLETED',
      startsAt: daysAgo(9),
      endsAt: daysAgo(9, 2),
      registrationOpensAt: daysAgo(12),
      registrationClosesAt: daysAgo(10),
      checkInOpensAt: daysAgo(9),
      checkInClosesAt: daysAgo(9, 3),
    });

    const res = await request(app.getHttpServer())
      .get(`${CLUBS_PATH}/${club.id}`)
      .set('Cookie', lead.sessionCookie);

    expect(res.body.upcoming.map((e: { id: string }) => e.id)).toEqual([soon.id]);
    expect(res.body.past.map((e: { id: string }) => e.id)).toEqual([ran.id]);
    expect(res.body.eventsRun).toBe(1);
  });

  it('carries the committee, active appointments only', async () => {
    // The invited officer is the discriminator: listing every appointment would
    // publish a name on the club page before that person accepted.
    const student = await loginAsStudent(app);
    const club = await makeClub();
    const lead = await makeActiveLead(app, club.id);
    const pending = await mkUser();
    await inviteOfficer(club.id, pending.id, 'CTO');

    const res = await request(app.getHttpServer())
      .get(`${CLUBS_PATH}/${club.id}`)
      .set('Cookie', student.sessionCookie);

    expect(res.body.committee).toHaveLength(1);
    expect(res.body.committee[0].userId).toBe(lead.userId);
    expect(res.body.committee[0].role).toBe('LEAD');
    // An address is directory data; the club page is open to every signed-in user.
    expect(res.body.committee[0]).not.toHaveProperty('userEmail');
  });

  it('returns 404 for a well-formed but unknown id', async () => {
    const student = await loginAsStudent(app);
    const res = await request(app.getHttpServer())
      .get(`${CLUBS_PATH}/00000000-0000-7000-8000-000000000000`)
      .set('Cookie', student.sessionCookie);

    expect(res.status).toBe(404);
  });
});

describe('GET /clubs/by-slug/:slug', () => {
  it('resolves the same club the id route does', async () => {
    const student = await loginAsStudent(app);
    const club = await makeClub();

    const res = await request(app.getHttpServer())
      .get(`${CLUBS_PATH}/by-slug/${club.slug}`)
      .set('Cookie', student.sessionCookie);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(club.id);
  });

  it('reports the viewer own membership, not another user', async () => {
    const student = await loginAsStudent(app);
    const other = await loginAsStudent(app);
    const club = await makeClub();
    await prisma.clubMembership.create({
      data: { clubId: club.id, userId: other.userId, status: 'ACTIVE' },
    });

    const res = await request(app.getHttpServer())
      .get(`${CLUBS_PATH}/by-slug/${club.slug}`)
      .set('Cookie', student.sessionCookie);

    expect(res.body.viewerMembershipStatus).toBeNull();
  });

  it('is 404 on a suspended club for a student holding its slug', async () => {
    // The whole defect: the slug is public, the club is not, and a UI query
    // parameter was the only thing hiding it.
    const student = await loginAsStudent(app);
    const club = await makeClub({ status: 'SUSPENDED' });

    const res = await request(app.getHttpServer())
      .get(`${CLUBS_PATH}/by-slug/${club.slug}`)
      .set('Cookie', student.sessionCookie);

    expect(res.status).toBe(404);
  });

  it('still opens that club for one of its own active officers', async () => {
    // Paired with the test above: a gate that refused everybody would pass that
    // one and lock every officer out of their own suspended club.
    const club = await makeClub({ status: 'SUSPENDED' });
    const lead = await makeActiveLead(app, club.id);

    const res = await request(app.getHttpServer())
      .get(`${CLUBS_PATH}/by-slug/${club.slug}`)
      .set('Cookie', lead.sessionCookie);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(club.id);
  });

  it('still opens that club for an Admin', async () => {
    const admin = await loginAsAdmin(app);
    const club = await makeClub({ status: 'ARCHIVED' });

    const res = await request(app.getHttpServer())
      .get(`${CLUBS_PATH}/by-slug/${club.slug}`)
      .set('Cookie', admin.sessionCookie);

    expect(res.status).toBe(200);
  });

  it('returns 404 for an unknown slug', async () => {
    const student = await loginAsStudent(app);
    expect(
      (await request(app.getHttpServer())
        .get(`${CLUBS_PATH}/by-slug/no-such-club`)
        .set('Cookie', student.sessionCookie)).status,
    ).toBe(404);
  });
});

describe('PATCH /clubs/:clubId, admin override', () => {
  // With no Admin PATCH covered, the suite stayed green when overrideReasonFor
  // made every one of them a 422 no screen could satisfy.
  it('refuses a club-roleless admin with no reason and records one when given', async () => {
    const club = await makeClub();
    const admin = await loginAsAdmin(app);

    const patch = (body: object) =>
      request(app.getHttpServer())
        .patch(`${CLUBS_PATH}/${club.id}`)
        .set('Cookie', admin.sessionCookie)
        .send(body);

    const bare = await patch({ category: 'Robotics' });
    expect(bare.status).toBe(422);
    expect(bare.body.detail).toBe('An admin override requires a reason.');
    expect((await prisma.club.findUniqueOrThrow({ where: { id: club.id } })).category).toBe(
      club.category,
    );

    const withReason = await patch({ category: 'Robotics', overrideReason: 'Miscategorised.' });
    expect(withReason.status).toBe(200);
    expect((await prisma.club.findUniqueOrThrow({ where: { id: club.id } })).category).toBe('Robotics');

    const row = await prisma.auditLog.findFirst({
      where: { action: 'club.updated', entityId: club.id },
      orderBy: { createdAt: 'desc' },
    });
    expect(row?.reason).toBe('Miscategorised.');
  });
});
