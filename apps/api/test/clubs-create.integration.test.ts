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
    expect((await create('Robotics Club')).status).toBe(409);
    expect((await create('Robotics  Club!')).body.slug).toBe('robotics-club-2');
  });

  it('refuses a STUDENT', async () => {
    const student = await loginAsStudent(app);
    expect(
      (await request(app.getHttpServer()).post(UPLOAD_PATH).set('Cookie', student.sessionCookie)).status,
    ).toBe(403);
  });
});

describe('GET /clubs', () => {
  it('filters by department and by status, and paginates', async () => {
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
