import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { EXAMPLE_QR_SIGNING_SECRET } from '../src/config/env.schema';
import { QrPassService } from '../src/attendance/qr-pass.service';
import { verifyPass } from '../src/attendance/qr-token';
import { API_PREFIX } from '../src/config/api-prefix';
import { createTestApp } from './app';
import { loginAsStudent } from './auth-helpers';
import { createTestPrisma, disconnectTestPrisma, truncateAll } from './db';

const prisma = createTestPrisma();
let app: INestApplication;

// No QR_SIGNING_SECRET in the integration environment, so the service signs
// with the schema's development default.
const SECRET = process.env.QR_SIGNING_SECRET ?? EXAMPLE_QR_SIGNING_SECRET;

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

function getPass(cookie: string) {
  return request(app.getHttpServer()).get(`${API_PREFIX}/me/qr-pass`).set('Cookie', cookie);
}

function rotatePass(cookie: string) {
  return request(app.getHttpServer()).post(`${API_PREFIX}/me/qr-pass/rotate`).set('Cookie', cookie);
}

describe('GET /me/qr-pass', () => {
  it('creates the pass on first call and returns a token that verifies to its owner', async () => {
    const student = await loginAsStudent(app);

    const res = await getPass(student.sessionCookie);

    expect(res.status).toBe(200);
    expect(res.body.tokenVersion).toBe(1);

    const verified = verifyPass(res.body.token as string, SECRET);
    expect(verified.ok).toBe(true);
    // The token must commit to the OWNER, not just to something well-formed: a
    // pass carrying a different user id checks the wrong person in.
    expect(verified.ok && verified.payload.userId).toBe(student.userId);

    const rows = await prisma.qrPass.findMany({ where: { userId: student.userId } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.tokenVersion).toBe(1);
  });

  it('stores no raw token anywhere', async () => {
    // Only the version the signature commits to is stored. Catches an
    // implementation persisting what it issued, making the pass table a list of
    // live credentials.
    const student = await loginAsStudent(app);
    const res = await getPass(student.sessionCookie);

    const row = await prisma.qrPass.findUniqueOrThrow({ where: { userId: student.userId } });
    expect(JSON.stringify(row)).not.toContain(res.body.token);
  });

  it('answers two colliding first-time inserts with the one row that won', async () => {
    // qr_pass.user_id is unique and the first call races itself across two tabs.
    // Two concurrent GETs do not reliably collide (the second findUnique usually
    // sees the other's committed row), so the insert path is driven directly:
    // both INSERTs run, one takes the P2002, and a service that rethrows turns
    // the race into a 500 on the student's QR screen.
    const student = await loginAsStudent(app);
    const service = app.get(QrPassService);
    const create = (
      service as unknown as { create: (userId: string) => Promise<{ id: string }> }
    ).create.bind(service);

    const rows = await Promise.all([create(student.userId), create(student.userId)]);

    expect(rows[0]!.id).toBe(rows[1]!.id);
    expect(await prisma.qrPass.count({ where: { userId: student.userId } })).toBe(1);
  });
});

describe('POST /me/qr-pass/rotate', () => {
  it('kills every previously issued image', async () => {
    // The version is inside the signed payload and every scan re-checks it
    // against the row, so this mismatch is what kills the old image.
    const student = await loginAsStudent(app);
    const before = await getPass(student.sessionCookie);

    const res = await rotatePass(student.sessionCookie);
    expect(res.status).toBe(200);
    expect(res.body.tokenVersion).toBe(2);

    const old = verifyPass(before.body.token as string, SECRET);
    const fresh = verifyPass(res.body.token as string, SECRET);
    // The old token still verifies, being genuinely signed, and is dead anyway
    // because its version no longer matches the stored one.
    expect(old.ok && old.payload.tokenVersion).toBe(1);
    expect(fresh.ok && fresh.payload.tokenVersion).toBe(2);

    const row = await prisma.qrPass.findUniqueOrThrow({ where: { userId: student.userId } });
    expect(row.tokenVersion).toBe(2);
    expect(old.ok && old.payload.tokenVersion).not.toBe(row.tokenVersion);
    expect(row.lastRotatedAt).not.toBeNull();
  });

  it('writes an audit row carrying versions and no token', async () => {
    const student = await loginAsStudent(app);
    await getPass(student.sessionCookie);
    const res = await rotatePass(student.sessionCookie);

    const rows = await prisma.auditLog.findMany({ where: { action: 'qr_pass.rotated' } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.actorUserId).toBe(student.userId);
    expect(rows[0]?.before).toEqual({ tokenVersion: 1 });
    expect(rows[0]?.after).toEqual({ tokenVersion: 2 });
    // An audit row never contains a raw QR token.
    expect(JSON.stringify(rows[0])).not.toContain(res.body.token);
  });

  it('creates the pass when the owner has never opened their QR screen', async () => {
    const student = await loginAsStudent(app);

    const res = await rotatePass(student.sessionCookie);

    expect(res.status).toBe(200);
    expect(res.body.tokenVersion).toBe(1);
  });
});

describe('pass ownership', () => {
  it('returns each caller their own pass and never another user', async () => {
    // Catches a handler reading the user id off the request rather than the
    // session, the shape of every "return my X" IDOR.
    const [one, two] = await Promise.all([loginAsStudent(app), loginAsStudent(app)]);

    const first = verifyPass((await getPass(one!.sessionCookie)).body.token as string, SECRET);
    const second = verifyPass((await getPass(two!.sessionCookie)).body.token as string, SECRET);

    expect(first.ok && first.payload.userId).toBe(one!.userId);
    expect(second.ok && second.payload.userId).toBe(two!.userId);
  });
});
