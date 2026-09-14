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

// The integration environment has no QR_SIGNING_SECRET set, so the schema's
// development default is what the service signs with.
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
    // The token has to commit to the OWNER, not merely to something
    // well-formed: a pass that verified but carried a different user id
    // would check the wrong person in.
    expect(verified.ok && verified.payload.userId).toBe(student.userId);

    const rows = await prisma.qrPass.findMany({ where: { userId: student.userId } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.tokenVersion).toBe(1);
  });

  it('stores no raw token anywhere', async () => {
    // Spec 5.1: "no raw token is stored, only the version that the signature
    // commits to". Catches an implementation that persists what it issued,
    // which would make the pass table a list of live credentials.
    const student = await loginAsStudent(app);
    const res = await getPass(student.sessionCookie);

    const row = await prisma.qrPass.findUniqueOrThrow({ where: { userId: student.userId } });
    expect(JSON.stringify(row)).not.toContain(res.body.token);
  });

  it('answers two colliding first-time inserts with the one row that won', async () => {
    // qr_pass.user_id is unique and the first call races itself from two
    // tabs. Two concurrent GETs do NOT reliably produce that collision
    // (whichever request reaches its findUnique second usually finds the
    // other's committed row and never inserts), so the insert path is
    // driven directly here. Both INSERTs then run, one takes the P2002, and
    // a service that rethrows it turns an ordinary race into a 500 on the
    // student's own QR screen. Verified: this goes red against a rethrow,
    // where the two-GET version passed.
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
    // The version lives inside the signed payload and every scan re-checks
    // it against the row, so this mismatch IS the death of the old image.
    const student = await loginAsStudent(app);
    const before = await getPass(student.sessionCookie);

    const res = await rotatePass(student.sessionCookie);
    expect(res.status).toBe(200);
    expect(res.body.tokenVersion).toBe(2);

    const old = verifyPass(before.body.token as string, SECRET);
    const fresh = verifyPass(res.body.token as string, SECRET);
    // The old token still verifies (it was genuinely signed) and is dead
    // anyway, because its version no longer matches the stored one.
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
    // Spec 5.1: an audit row never contains a raw QR token.
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
    // Catches a handler that reads a user id off the request instead of off
    // the session, the shape of every "return my X" IDOR.
    const [one, two] = await Promise.all([loginAsStudent(app), loginAsStudent(app)]);

    const first = verifyPass((await getPass(one!.sessionCookie)).body.token as string, SECRET);
    const second = verifyPass((await getPass(two!.sessionCookie)).body.token as string, SECRET);

    expect(first.ok && first.payload.userId).toBe(one!.userId);
    expect(second.ok && second.payload.userId).toBe(two!.userId);
  });
});
