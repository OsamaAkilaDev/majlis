import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { API_PREFIX } from '../src/config/api-prefix';
import { createTestApp } from './app';
import { loginAsAdmin, loginAsStudent } from './auth-helpers';
import { createTestPrisma, disconnectTestPrisma, truncateAll } from './db';
import { aClub, aDepartment, uniq } from './factories';

const DEPARTMENTS_PATH = `${API_PREFIX}/departments`;

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

describe('POST /departments', () => {
  it('creates one for an Admin', async () => {
    const admin = await loginAsAdmin(app);
    const res = await request(app.getHttpServer())
      .post(DEPARTMENTS_PATH)
      .set('Cookie', admin.sessionCookie)
      .send({ name: 'Computer Science', code: 'CS' });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ name: 'Computer Science', code: 'CS', clubCount: 0 });
  });

  it('refuses a STUDENT', async () => {
    const student = await loginAsStudent(app);
    const res = await request(app.getHttpServer())
      .post(DEPARTMENTS_PATH)
      .set('Cookie', student.sessionCookie)
      .send({ name: 'Computer Science', code: 'CS' });

    expect(res.status).toBe(403);
  });

  it('returns 409 for a duplicate code', async () => {
    const admin = await loginAsAdmin(app);
    const send = () =>
      request(app.getHttpServer())
        .post(DEPARTMENTS_PATH)
        .set('Cookie', admin.sessionCookie)
        .send({ name: uniq('Dept'), code: 'CS' });

    expect((await send()).status).toBe(201);
    // Catches a handler that lets Prisma's P2002 escape as a bare 500.
    expect((await send()).status).toBe(409);
  });
});

describe('PATCH /departments/:id', () => {
  it('lets an Admin update the name, keeping clubCount correct', async () => {
    const admin = await loginAsAdmin(app);
    const dept = await prisma.department.create({ data: aDepartment() });
    await prisma.club.create({ data: aClub(dept.id) });

    const res = await request(app.getHttpServer())
      .patch(`${DEPARTMENTS_PATH}/${dept.id}`)
      .set('Cookie', admin.sessionCookie)
      .send({ name: 'Renamed Department' });

    expect(res.status).toBe(200);
    // Catches a handler ignoring the body, or a clubCount hardcoded or dropped
    // on the update path.
    expect(res.body).toMatchObject({ name: 'Renamed Department', clubCount: 1 });
  });

  it('refuses a STUDENT, and the write does not happen', async () => {
    // Every happy path above passes with no @RequirePermission at all. The
    // read-back catches a second bug the status check misses: a handler that
    // writes first and denies afterwards.
    const student = await loginAsStudent(app);
    const dept = await prisma.department.create({ data: aDepartment() });

    const res = await request(app.getHttpServer())
      .patch(`${DEPARTMENTS_PATH}/${dept.id}`)
      .set('Cookie', student.sessionCookie)
      .send({ name: 'Should Not Apply' });

    expect(res.status).toBe(403);
    expect(await prisma.department.findUnique({ where: { id: dept.id } })).toMatchObject({
      name: dept.name,
    });
  });

  it('returns 404 for a well-formed but unknown id', async () => {
    // A well-formed UUID matching no row, not a malformed string:
    // @prisma/adapter-pg raises P2007 for a malformed UUID, testing a different
    // mapping. Catches a handler letting P2025 escape as a bare 500.
    const admin = await loginAsAdmin(app);
    const res = await request(app.getHttpServer())
      .patch(`${DEPARTMENTS_PATH}/00000000-0000-7000-8000-000000000000`)
      .set('Cookie', admin.sessionCookie)
      .send({ name: 'Nobody Home' });

    expect(res.status).toBe(404);
  });

  it("returns 409 when renamed to another department's existing code, leaving the target unchanged", async () => {
    const admin = await loginAsAdmin(app);
    await prisma.department.create({ data: aDepartment({ code: 'TAKEN' }) });
    const dept = await prisma.department.create({ data: aDepartment() });

    const res = await request(app.getHttpServer())
      .patch(`${DEPARTMENTS_PATH}/${dept.id}`)
      .set('Cookie', admin.sessionCookie)
      .send({ code: 'TAKEN' });

    // Catches a handler letting P2002 escape as a bare 500, and, via the
    // unchanged-row check, a partial write committed before the violation.
    expect(res.status).toBe(409);
    expect(await prisma.department.findUnique({ where: { id: dept.id } })).toMatchObject({
      code: dept.code,
    });
  });
});

describe('DELETE /departments/:id', () => {
  it('refuses to delete a department that still has a club', async () => {
    // The onDelete: Restrict guarantee. Catches a service deleting without
    // catching the foreign key violation, which surfaces as an unexplained 500.
    const admin = await loginAsAdmin(app);
    const dept = await prisma.department.create({ data: aDepartment() });
    await prisma.club.create({ data: aClub(dept.id) });

    const res = await request(app.getHttpServer())
      .delete(`${DEPARTMENTS_PATH}/${dept.id}`)
      .set('Cookie', admin.sessionCookie);

    expect(res.status).toBe(409);
    expect(await prisma.department.findUnique({ where: { id: dept.id } })).not.toBeNull();
  });

  it('deletes an empty department', async () => {
    const admin = await loginAsAdmin(app);
    const dept = await prisma.department.create({ data: aDepartment() });

    expect(
      (
        await request(app.getHttpServer())
          .delete(`${DEPARTMENTS_PATH}/${dept.id}`)
          .set('Cookie', admin.sessionCookie)
      ).status,
    ).toBe(204);
    expect(await prisma.department.findUnique({ where: { id: dept.id } })).toBeNull();
  });
});

describe('GET /departments', () => {
  it('is readable by any signed-in user and reports the club count', async () => {
    const student = await loginAsStudent(app);
    const dept = await prisma.department.create({ data: aDepartment() });
    await prisma.club.create({ data: aClub(dept.id) });

    const res = await request(app.getHttpServer())
      .get(DEPARTMENTS_PATH)
      .set('Cookie', student.sessionCookie);

    expect(res.status).toBe(200);
    // Catches a count taken from the wrong relation or hardcoded to zero.
    expect(res.body.items.find((d: { id: string }) => d.id === dept.id).clubCount).toBe(1);
  });

  it('refuses an anonymous request', async () => {
    expect((await request(app.getHttpServer()).get(DEPARTMENTS_PATH)).status).toBe(401);
  });
});
