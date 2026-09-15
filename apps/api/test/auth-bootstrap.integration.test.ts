import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { API_PREFIX } from '../src/config/api-prefix';
import { loginAsAdmin, loginAsStudent } from './auth-helpers';
import { createTestApp } from './app';
import { createTestPrisma, disconnectTestPrisma, truncateAll } from './db';
import { uniq } from './factories';

const BOOTSTRAP_PATH = `${API_PREFIX}/auth/bootstrap`;
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

function getStatus(): request.Test {
  return request(app.getHttpServer()).get(BOOTSTRAP_PATH);
}

function postBootstrap(overrides: { email?: string; password?: string; fullName?: string } = {}) {
  return request(app.getHttpServer())
    .post(BOOTSTRAP_PATH)
    .send({
      email: overrides.email ?? `${uniq('admin')}@uni.ac.ae`,
      password: overrides.password ?? 'correct-horse-battery',
      fullName: overrides.fullName ?? 'First Admin',
    });
}

function adminCount(): Promise<number> {
  return prisma.user.count({ where: { platformRole: 'ADMIN' } });
}

describe('GET /auth/bootstrap', () => {
  it('reports that an admin is needed when the database is empty', async () => {
    const res = await getStatus();
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ needsAdmin: true });
  });

  it('still reports one is needed when non-admin accounts exist', async () => {
    // The discriminating case. An implementation that counts USERS rather
    // than ADMINS passes the test above and fails here, and in production it
    // would lock the setup screen away the moment any student signed up,
    // leaving the deployment with no route to an admin at all.
    await loginAsStudent(app);
    await loginAsStudent(app);

    const res = await getStatus();
    expect(res.body).toEqual({ needsAdmin: true });
  });

  it('reports no admin is needed once one exists', async () => {
    await loginAsAdmin(app);

    const res = await getStatus();
    expect(res.body).toEqual({ needsAdmin: false });
  });
});

describe('POST /auth/bootstrap', () => {
  it('creates an ADMIN and signs the caller straight in', async () => {
    const email = `${uniq('founder')}@uni.ac.ae`;
    const res = await postBootstrap({ email });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ email, platformRole: 'ADMIN', clubRoles: [] });

    const row = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(row.platformRole).toBe('ADMIN');
  });

  it('stores the password as an argon2id hash, never in plaintext', async () => {
    const email = `${uniq('founder')}@uni.ac.ae`;
    await postBootstrap({ email, password: 'correct-horse-battery' });

    const row = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(row.passwordHash).not.toContain('correct-horse-battery');
    expect(row.passwordHash.startsWith('$argon2id$')).toBe(true);
  });

  it('issues a session that actually reaches an Admin-only route', async () => {
    // Catches a bootstrap that creates the row with the default STUDENT role
    // and reports success anyway: the response body could still be made to
    // say ADMIN, but SessionGuard re-derives the role from the database, so
    // only a genuinely-promoted row gets past `user:list`.
    const res = await postBootstrap();
    const cookie = (res.headers['set-cookie'] as unknown as string[])
      .find((c) => c.startsWith('majlis_session='))!
      .split(';')[0]!;

    const users = await request(app.getHttpServer()).get(USERS_PATH).set('Cookie', cookie);
    expect(users.status).toBe(200);
  });

  it('refuses once an admin exists, and creates nothing', async () => {
    await postBootstrap();

    const second = await postBootstrap();
    expect(second.status).toBe(409);
    expect(await adminCount()).toBe(1);
  });

  it('refuses when the admin was created by any other means', async () => {
    // The guard must read the database, not a flag this endpoint set.
    await loginAsAdmin(app);

    const res = await postBootstrap();
    expect(res.status).toBe(409);
    expect(await adminCount()).toBe(1);
  });

  it('creates exactly one admin when two requests race', async () => {
    // The reason the service takes an advisory lock. Without it both
    // requests read zero admins, both pass the guard, and the deployment
    // ends up with two platform owners, one of them an attacker who lost
    // the race by milliseconds and won anyway.
    const [a, b] = await Promise.all([postBootstrap(), postBootstrap()]);

    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([201, 409]);
    expect(await adminCount()).toBe(1);
  });

  it('rejects a password under the shared minimum', async () => {
    const res = await postBootstrap({ password: 'short11!' });
    expect(res.status).toBe(400);
    expect(await adminCount()).toBe(0);
  });

  it('reports a taken email as a conflict rather than a server fault', async () => {
    const email = `${uniq('taken')}@uni.ac.ae`;
    await loginAsStudent(app, { email });

    const res = await postBootstrap({ email });
    expect(res.status).toBe(409);
    expect(await adminCount()).toBe(0);
  });

  it('writes an audit row with no actor, in the same transaction', async () => {
    const res = await postBootstrap();
    const userId = (res.body as { id: string }).id;

    const rows = await prisma.auditLog.findMany({ where: { entityId: userId } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      action: 'user.admin_bootstrapped',
      entityType: 'User',
      outcome: 'SUCCESS',
      // Nobody was signed in to do this. The column is nullable precisely
      // so an actor-less action does not have to invent one.
      actorUserId: null,
    });
  });

  it('writes no audit row when it refuses', async () => {
    await postBootstrap();
    const before = await prisma.auditLog.count();

    await postBootstrap();
    expect(await prisma.auditLog.count()).toBe(before);
  });

  it('leaves no user row behind when the audit write fails', async () => {
    // The transaction boundary, asserted rather than assumed: the audit row
    // and the admin row commit together or not at all.
    const { AuditService } = await import('../src/audit/audit.service');
    const audit = app.get(AuditService);
    const record = audit.record.bind(audit);
    audit.record = () => Promise.reject(new Error('audit down'));

    try {
      const res = await postBootstrap();
      expect(res.status).toBe(500);
      expect(await prisma.user.count()).toBe(0);
    } finally {
      audit.record = record;
    }
  });
});
