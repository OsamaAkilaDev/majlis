import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { API_PREFIX } from '../src/config/api-prefix';
import { StorageService } from '../src/storage/storage.service';
import { createTestApp } from './app';
import { loginAsAdmin, loginAsStudent } from './auth-helpers';
import { createTestPrisma, disconnectTestPrisma, truncateAll } from './db';
import { aDepartment, makeClub, uniq } from './factories';

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
    // This is the whole point of verifying before storing. The API never
    // sees the bytes, so without this check a client can create a club with
    // a logo pointing at nothing, and every screen renders a broken image
    // with no way to tell what went wrong.
    const admin = await loginAsAdmin(app);
    const dept = await prisma.department.create({ data: aDepartment() });
    const minted = await request(app.getHttpServer()).post(UPLOAD_PATH).set('Cookie', admin.sessionCookie);
    // Deliberately do not populate `uploaded`.

    const res = await request(app.getHttpServer())
      .post(CLUBS_PATH)
      .set('Cookie', admin.sessionCookie)
      .send({ ...validBody(dept.id), clubId: minted.body.clubId });

    expect(res.status).toBe(422);
    expect(await prisma.club.count()).toBe(0);
  });

  it('refuses an uploaded object that is over the kind cap', async () => {
    // Catches verification that checks existence but not size. The bucket
    // limit is 2 MB; the club logo cap is 256 KB, so a 1 MB object passes
    // the bucket and must still be refused here.
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
    // The name column is unique, so this must fail on name before slug.
    // uniqueSlug's pre-check already moved the second attempt's slug to
    // -2, so the only constraint left to fail here is the name.
    const collision = await create('Robotics Club');
    expect(collision.status).toBe(409);
    // The global Problem Details filter maps any escaping P2002 to a generic
    // 409 too, so the status code alone would pass even with mapWriteError
    // silently failing to match this constraint. The specific detail message
    // is what proves the mapping actually fired and picked the name branch.
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
    // Both routes carry @RequirePermission('club:create'), but only the
    // upload route above had a 403 test. This catches the same guard being
    // missing from `create` specifically.
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

    // Catches a filter built but never applied to the where clause, which
    // returns everything and still looks correct in a one-club fixture.
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].departmentName).toBe(a.name);
  });

  it('filters by status, holding department constant', async () => {
    // The two fixtures differ ONLY in status: a fixture that also varied
    // department (as the combined test used to) would let an
    // implementation that ignores `status` entirely pass unnoticed.
    const student = await loginAsStudent(app);
    const dept = await prisma.department.create({ data: aDepartment() });
    const archived = await makeClub({ departmentId: dept.id, status: 'ARCHIVED' });
    await makeClub({ departmentId: dept.id });

    const res = await request(app.getHttpServer())
      .get(`${CLUBS_PATH}?status=ARCHIVED`)
      .set('Cookie', student.sessionCookie);

    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].id).toBe(archived.id);
  });

  it('filters by name, case-insensitively', async () => {
    // Catches a `q` filter that is never applied, and separately a
    // case-sensitive `contains` despite the where clause claiming
    // `mode: 'insensitive'`.
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

    // Catches a findFirst with no userId filter, which returns whichever
    // membership row happens to come first and tells this student they are
    // already a member of a club they have never joined.
    expect(res.body.viewerMembershipStatus).toBeNull();
    expect(res.body.memberCount).toBe(1);
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

  it('returns 404 for an unknown slug', async () => {
    const student = await loginAsStudent(app);
    expect(
      (await request(app.getHttpServer())
        .get(`${CLUBS_PATH}/by-slug/no-such-club`)
        .set('Cookie', student.sessionCookie)).status,
    ).toBe(404);
  });
});
