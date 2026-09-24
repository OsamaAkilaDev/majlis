import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { API_PREFIX } from '../src/config/api-prefix';
import { SWEEP_SECRET_HEADER } from '../src/config/sweep-header';
import { EXAMPLE_LIFECYCLE_SWEEP_SECRET } from '../src/config/env.schema';
import { StorageService } from '../src/storage/storage.service';
import { CERTIFICATE_BUCKET, STORAGE_BUCKET } from '../src/storage/image-kinds';
import { createTestApp } from './app';
import { loginAsAdmin, loginAsStudent } from './auth-helpers';
import { createTestPrisma, disconnectTestPrisma, truncateAll } from './db';
import { makeActiveLead, makeActiveOfficer, makeClub, mkEvent, mkRegistration } from './factories';

const prisma = createTestPrisma();
let app: INestApplication;

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
/** Every club core-team role, which is exactly who may issue (2026-09-24). */
const CORE_TEAM = ['LEAD', 'VICE_LEAD', 'MARKETING', 'CTO', 'OPERATIONS'] as const;

/** Bytes the API produced, by object path. The bucket is recorded because it is
 * a security property: a certificate in the public bucket is readable at
 * /object/public/<path> with no cookie, whatever the URL is signed with. */
const uploaded = new Map<string, { size: number; contentType: string; bucket: string }>();

/** Every (path, bucket) createSignedDownloadUrl was asked to sign, in order. */
const signed: { path: string; bucket: string }[] = [];

const fakeStorage = {
  createSignedUploadUrl: async (path: string) => ({ signedUrl: `https://example.test/${path}`, token: 't' }),
  statObject: async (path: string) => uploaded.get(path) ?? null,
  putObject: async (path: string, body: Buffer, contentType: string, bucket = STORAGE_BUCKET) => {
    uploaded.set(path, { size: body.length, contentType, bucket });
  },
  publicUrlFor: (path: string, version: number) =>
    `https://example.supabase.co/storage/v1/object/public/majlis-storage/${path}?v=${version}`,
  createSignedDownloadUrl: async (path: string, expiresIn: number, bucket = STORAGE_BUCKET) => {
    signed.push({ path, bucket });
    return `https://example.supabase.co/storage/v1/object/sign/${bucket}/${path}?token=tok-${expiresIn}-${signed.length}`;
  },
};

beforeAll(async () => {
  app = await createTestApp([], [{ provide: StorageService, useValue: fakeStorage }]);
});

afterAll(async () => {
  await app.close();
  await disconnectTestPrisma(prisma);
});

beforeEach(async () => {
  uploaded.clear();
  signed.length = 0;
  await truncateAll(prisma);
});

function issue(cookie: string, eventId: string) {
  return request(app.getHttpServer())
    .post(`${API_PREFIX}/events/${eventId}/certificates/issue`)
    .set('Cookie', cookie)
    .send({});
}

function verify(code: string) {
  return request(app.getHttpServer()).get(`${API_PREFIX}/verify/${code}`);
}

/** An event that finished an hour ago, with one student checked in and one
 * not. An hour, not days: issuance waits for nothing but the event ending. */
async function aCertifiableEvent(overrides: Record<string, unknown> = {}, endedAgo = HOUR) {
  const now = Date.now();
  const endedAt = now - endedAgo;
  const club = await makeClub();
  const lead = await makeActiveLead(app, club.id);
  const ops = await makeActiveOfficer(app, club.id, 'OPERATIONS');
  const event = await mkEvent(club.id, lead.userId, {
    status: 'COMPLETED',
    certificateEnabled: true,
    certificateTitle: 'Certificate of Participation',
    certificateSignatory: 'Dr A Person, Dean of Students',
    startsAt: new Date(endedAt - 2 * HOUR),
    endsAt: new Date(endedAt),
    registrationOpensAt: new Date(endedAt - 30 * DAY),
    registrationClosesAt: new Date(endedAt - 3 * HOUR),
    capacity: 30,
    confirmedCount: 2,
    ...overrides,
  });

  const attendee = await loginAsStudent(app, { fullName: 'Amina Hassan' });
  const absentee = await loginAsStudent(app, { fullName: 'Never Came' });
  const attended = await mkRegistration(event.id, attendee.userId, 'CHECKED_IN');
  const missed = await mkRegistration(event.id, absentee.userId, 'NO_SHOW');
  await prisma.attendanceRecord.create({
    data: {
      registrationId: attended.id,
      eventId: event.id,
      userId: attendee.userId,
      checkedInById: ops.userId,
      method: 'QR_SCAN',
    },
  });

  return { club, lead, ops, event, attendee, absentee, attended, missed };
}

describe('POST /events/:eventId/certificates/issue', () => {
  it('issues one certificate per attendee and certifies the event', async () => {
    const { event, attendee, club } = await aCertifiableEvent();
    const admin = await loginAsAdmin(app);

    const res = await issue(admin.sessionCookie, event.id);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ issued: 1, total: 1 });

    const rows = await prisma.certificate.findMany({ where: { eventId: event.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.userId).toBe(attendee.userId);
    // All four snapshot columns, filled at issuance: a certificate joining to
    // the club at read time would be rewritten by a rename.
    expect(rows[0]?.holderNameSnapshot).toBe('Amina Hassan');
    expect(rows[0]?.eventTitleSnapshot).toBe(event.title);
    expect(rows[0]?.clubNameSnapshot).toBe(club.name);
    expect(rows[0]?.clubLogoSnapshotUrl).toBe(club.logoUrl);

    expect((await prisma.event.findUniqueOrThrow({ where: { id: event.id } })).status).toBe('CERTIFIED');
    const audit = await prisma.auditLog.findMany({ where: { action: 'certificate.issued_for_event' } });
    expect(audit).toHaveLength(1);
    expect(audit[0]?.after).toMatchObject({ status: 'CERTIFIED', issued: 1 });
  });

  it('issues nothing the second time it runs', async () => {
    // The partial unique index on registration_id WHERE status = 'ACTIVE' is the
    // guarantee; a second run must be a no-op, not a duplicate or an error.
    const { event } = await aCertifiableEvent();
    const admin = await loginAsAdmin(app);

    const first = await issue(admin.sessionCookie, event.id);
    const second = await issue(admin.sessionCookie, event.id);

    expect(first.body).toEqual({ issued: 1, total: 1 });
    expect(second.body).toEqual({ issued: 0, total: 1 });
    expect(await prisma.certificate.count({ where: { eventId: event.id } })).toBe(1);
    // No second CERTIFIED audit row for a transition that did not happen.
    expect(await prisma.auditLog.count({ where: { action: 'certificate.issued_for_event' } })).toBe(1);
  });

  it('gives a NO_SHOW nothing', async () => {
    const { event, absentee } = await aCertifiableEvent();
    const admin = await loginAsAdmin(app);

    await issue(admin.sessionCookie, event.id);

    expect(await prisma.certificate.count({ where: { userId: absentee.userId } })).toBe(0);
  });

  it('refuses an event that has not finished yet', async () => {
    const now = Date.now();
    const { event } = await aCertifiableEvent({
      status: 'ONGOING',
      startsAt: new Date(now - HOUR),
      endsAt: new Date(now + HOUR),
    });
    const admin = await loginAsAdmin(app);

    const res = await issue(admin.sessionCookie, event.id);

    expect(res.status).toBe(422);
    expect(res.body.detail).toBe('That event has not finished yet.');
    expect(await prisma.certificate.count({ where: { eventId: event.id } })).toBe(0);
  });

  it.each(CORE_TEAM)('lets the club %s issue', async (role) => {
    const { club, event, lead } = await aCertifiableEvent();
    // A club holds one active Lead (club_team_appointment_one_active_lead),
    // and the fixture already appointed it.
    const officer = role === 'LEAD' ? lead : await makeActiveOfficer(app, club.id, role);

    const res = await issue(officer.sessionCookie, event.id);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ issued: 1, total: 1 });
  });

  it('refuses a Lead of a different club', async () => {
    // Catches an unscoped rule: a club role anywhere must not reach this club.
    const { event } = await aCertifiableEvent();
    const elsewhere = await makeClub();
    const stranger = await makeActiveLead(app, elsewhere.id);

    const res = await issue(stranger.sessionCookie, event.id);

    expect(res.status).toBe(403);
    expect(await prisma.certificate.count({ where: { eventId: event.id } })).toBe(0);
    const denied = await prisma.auditLog.findMany({ where: { outcome: 'DENIED' } });
    expect(denied[0]?.reason).toBe('certificate:manage');
  });

  it('refuses a student with no role in the club', async () => {
    const { event, attendee } = await aCertifiableEvent();

    const res = await issue(attendee.sessionCookie, event.id);

    expect(res.status).toBe(403);
  });
});

describe('nothing issues on its own', () => {
  // Attendance stays correctable until issuance, so issuance is a decision
  // somebody takes, never a side effect of time passing or of a page view.
  it('the lifecycle sweep leaves a finished event uncertified', async () => {
    const { event } = await aCertifiableEvent({}, 20 * DAY);

    const res = await request(app.getHttpServer())
      .post(`${API_PREFIX}/internal/lifecycle-sweep`)
      .set(SWEEP_SECRET_HEADER, process.env.LIFECYCLE_SWEEP_SECRET ?? EXAMPLE_LIFECYCLE_SWEEP_SECRET);

    expect(res.status).toBe(200);
    expect(await prisma.certificate.count({ where: { eventId: event.id } })).toBe(0);
    expect((await prisma.event.findUniqueOrThrow({ where: { id: event.id } })).status).toBe('COMPLETED');
  });

  it('opening a finished event issues nothing', async () => {
    const { event, lead } = await aCertifiableEvent({}, 20 * DAY);

    const res = await request(app.getHttpServer())
      .get(`${API_PREFIX}/events/${event.id}`)
      .set('Cookie', lead.sessionCookie);

    expect(res.status).toBe(200);
    expect(await prisma.certificate.count({ where: { eventId: event.id } })).toBe(0);
  });
});

describe('GET /certificates/:id/pdf', () => {
  it('renders and uploads once, then signs a fresh short-lived URL per call', async () => {
    const { event, attendee } = await aCertifiableEvent();
    const admin = await loginAsAdmin(app);
    await issue(admin.sessionCookie, event.id);
    const certificate = await prisma.certificate.findFirstOrThrow({ where: { eventId: event.id } });

    const first = await request(app.getHttpServer())
      .get(`${API_PREFIX}/certificates/${certificate.id}/pdf`)
      .set('Cookie', attendee.sessionCookie);

    expect(first.status).toBe(200);
    expect(first.body.pdfUrl).toContain(`certificates/${certificate.id}/certificate.pdf`);
    // The object path is a pure function of the certificate id, which every
    // holder of registration:read can list, so a public URL makes the ownership
    // check below decorative.
    expect(first.body.pdfUrl).not.toContain('/object/public/');
    expect(first.body.pdfUrl).toContain('/object/sign/');
    expect(first.body.pdfUrl).toContain('token=');
    expect(signed).toEqual([
      { path: `certificates/${certificate.id}/certificate.pdf`, bucket: CERTIFICATE_BUCKET },
    ]);
    // Signing alone closes nothing: majlis-storage is a PUBLIC bucket, so bytes
    // written there stay readable at /object/public/<path> however the URL is
    // handed out. Both the bytes and the signature must be against the private
    // bucket. Verified live: anonymous /object/public/ on majlis-certificates
    // answers 400, a signed URL 200, a tampered token 400.
    const object = uploaded.get(`certificates/${certificate.id}/certificate.pdf`);
    expect(object?.bucket).toBe(CERTIFICATE_BUCKET);
    expect(object?.bucket).not.toBe(STORAGE_BUCKET);
    // A real PDF, not an empty buffer: the render fails silently once the fake
    // storage accepts anything.
    expect(object?.contentType).toBe('application/pdf');
    expect(object?.size).toBeGreaterThan(1000);

    uploaded.clear();
    const second = await request(app.getHttpServer())
      .get(`${API_PREFIX}/certificates/${certificate.id}/pdf`)
      .set('Cookie', attendee.sessionCookie);

    // Catches a persisted URL replayed on every call: the first signature
    // expires, so a stored one is either long-lived or already dead.
    expect(second.body.pdfUrl).not.toBe(first.body.pdfUrl);
    expect(second.body.pdfUrl).toContain('/object/sign/');
    // Rendered once, on the first download, which is what keeps issuance cheap
    // enough to run inline.
    expect(uploaded.size).toBe(0);
  });

  it('refuses to hand somebody else’s certificate to a signed-in student', async () => {
    const { event } = await aCertifiableEvent();
    const admin = await loginAsAdmin(app);
    await issue(admin.sessionCookie, event.id);
    const certificate = await prisma.certificate.findFirstOrThrow({ where: { eventId: event.id } });
    const stranger = await loginAsStudent(app);

    const res = await request(app.getHttpServer())
      .get(`${API_PREFIX}/certificates/${certificate.id}/pdf`)
      .set('Cookie', stranger.sessionCookie);

    expect(res.status).toBe(403);
    expect(res.body.detail).toBe('That certificate belongs to someone else.');
  });
});

describe('GET /verify/:code', () => {
  it('resolves an active certificate while signed out, and discloses six fields', async () => {
    const { event } = await aCertifiableEvent();
    const admin = await loginAsAdmin(app);
    await issue(admin.sessionCookie, event.id);
    const certificate = await prisma.certificate.findFirstOrThrow({ where: { eventId: event.id } });

    const res = await verify(certificate.verificationCode);

    expect(res.status).toBe(200);
    // Pinned exactly: a widened response on an anonymous route publishes
    // whatever was added to the world.
    expect(Object.keys(res.body).sort()).toEqual([
      'clubName',
      'eventTitle',
      'holderName',
      'issuedAt',
      'revokedAt',
      'status',
    ]);
    expect(res.body.status).toBe('ACTIVE');
    expect(res.body.holderName).toBe('Amina Hassan');
  });

  it('answers an unknown code with a 404 that names nothing', async () => {
    const res = await verify('ZZZZZ-ZZZZZ-ZZZZZ-ZZZZZ-ZZZZZ-ZZZZZ');

    expect(res.status).toBe(404);
    expect(res.body.detail).toBe('No certificate matches that code.');
  });

  it('reports a revoked certificate as REVOKED with its date, rather than hiding it', async () => {
    const { event } = await aCertifiableEvent();
    const admin = await loginAsAdmin(app);
    await issue(admin.sessionCookie, event.id);
    const certificate = await prisma.certificate.findFirstOrThrow({ where: { eventId: event.id } });

    const revoked = await request(app.getHttpServer())
      .post(`${API_PREFIX}/certificates/${certificate.id}/revoke`)
      .set('Cookie', admin.sessionCookie)
      .send({ reason: 'Issued against a corrected attendance record' });
    expect(revoked.status).toBe(200);

    const res = await verify(certificate.verificationCode);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('REVOKED');
    expect(res.body.revokedAt).not.toBeNull();
    // Same six keys as an active one: an employer must learn it was revoked,
    // and the reason is not theirs to read.
    expect(Object.keys(res.body).sort()).toEqual([
      'clubName',
      'eventTitle',
      'holderName',
      'issuedAt',
      'revokedAt',
      'status',
    ]);

    const audit = await prisma.auditLog.findMany({ where: { action: 'certificate.revoked' } });
    expect(audit[0]?.reason).toBe('Issued against a corrected attendance record');
  });
});

describe('an attendance correction after the certificates have issued', () => {
  it('revokes the certificate of someone corrected to absent, so /verify stops saying ACTIVE', async () => {
    const { event, attended } = await aCertifiableEvent();
    const admin = await loginAsAdmin(app);
    await issue(admin.sessionCookie, event.id);
    const certificate = await prisma.certificate.findFirstOrThrow({ where: { eventId: event.id } });
    expect((await verify(certificate.verificationCode)).body.status).toBe('ACTIVE');

    // Catches a correction that does not revoke: /verify keeps answering ACTIVE,
    // with that student's name, indefinitely.
    const res = await request(app.getHttpServer())
      .patch(`${API_PREFIX}/events/${event.id}/attendance/${attended.id}`)
      .set('Cookie', admin.sessionCookie)
      .send({
        present: false,
        reason: 'Scanned the wrong badge at the door',
        override: { reason: 'Registrar review after the event was certified' },
      });

    expect(res.status).toBe(204);

    const after = await verify(certificate.verificationCode);
    expect(after.status).toBe(200);
    expect(after.body.status).toBe('REVOKED');
    expect(after.body.revokedAt).not.toBeNull();

    const row = await prisma.certificate.findUniqueOrThrow({ where: { id: certificate.id } });
    expect(row.revokedById).toBe(admin.userId);
    expect(row.revokedReason).toBe('Scanned the wrong badge at the door');

    // Audited in the same transaction as the correction.
    const audit = await prisma.auditLog.findMany({ where: { action: 'certificate.revoked' } });
    expect(audit).toHaveLength(1);
    expect(audit[0]?.actorUserId).toBe(admin.userId);
    expect(audit[0]?.reason).toBe('Scanned the wrong badge at the door');
  });
});

describe('POST /certificates/:id/reissue', () => {
  it('revokes the old row, issues a fresh one, and leaves both verifiable', async () => {
    const { event, attendee } = await aCertifiableEvent();
    const admin = await loginAsAdmin(app);
    await issue(admin.sessionCookie, event.id);
    const old = await prisma.certificate.findFirstOrThrow({ where: { eventId: event.id } });

    // A name correction after issuance is the case reissue exists for.
    await prisma.user.update({ where: { id: attendee.userId }, data: { fullName: 'Amina Al Hassan' } });

    const res = await request(app.getHttpServer())
      .post(`${API_PREFIX}/certificates/${old.id}/reissue`)
      .set('Cookie', admin.sessionCookie)
      .send({ reason: 'Holder name corrected in the registry' });

    expect(res.status).toBe(200);
    expect(res.body.holderName).toBe('Amina Al Hassan');
    expect(res.body.serialNumber).not.toBe(old.serialNumber);

    // The partial unique index allows one ACTIVE row per registration, so this
    // holds only if the revoke landed first.
    const rows = await prisma.certificate.findMany({ where: { registrationId: old.registrationId } });
    expect(rows).toHaveLength(2);
    expect(rows.filter((r) => r.status === 'ACTIVE')).toHaveLength(1);

    // Both stay verifiable, which is why reissue revokes rather than deletes:
    // the old document is out there on somebody's wall.
    expect((await verify(old.verificationCode)).body.status).toBe('REVOKED');
    expect((await verify(res.body.verificationCode)).body.status).toBe('ACTIVE');
    // The old row's snapshot still says what it always said.
    expect((await verify(old.verificationCode)).body.holderName).toBe('Amina Hassan');
  });

  it("lets the club Marketing officer reissue, and refuses another club's Lead", async () => {
    // Certificate-scoped: the guard resolves the club through the certificate,
    // so a Lead elsewhere holds nothing here.
    const { club, event } = await aCertifiableEvent();
    const admin = await loginAsAdmin(app);
    await issue(admin.sessionCookie, event.id);
    const old = await prisma.certificate.findFirstOrThrow({ where: { eventId: event.id } });
    const marketing = await makeActiveOfficer(app, club.id, 'MARKETING');
    const stranger = await makeActiveLead(app, (await makeClub()).id);

    const refused = await request(app.getHttpServer())
      .post(`${API_PREFIX}/certificates/${old.id}/reissue`)
      .set('Cookie', stranger.sessionCookie)
      .send({ reason: 'Not my club' });
    expect(refused.status).toBe(403);
    const revokeRefused = await request(app.getHttpServer())
      .post(`${API_PREFIX}/certificates/${old.id}/revoke`)
      .set('Cookie', stranger.sessionCookie)
      .send({ reason: 'Not my club' });
    expect(revokeRefused.status).toBe(403);

    const res = await request(app.getHttpServer())
      .post(`${API_PREFIX}/certificates/${old.id}/reissue`)
      .set('Cookie', marketing.sessionCookie)
      .send({ reason: 'Holder name corrected in the registry' });
    expect(res.status).toBe(200);
  });

  it('tells the holder about the replacement, not only about the revocation', async () => {
    // A reissue is both an issue and a revoke. Catches an inbox saying only
    // "revoked" during a name correction, the opposite of what happened.
    const { event, attendee } = await aCertifiableEvent();
    const admin = await loginAsAdmin(app);
    await issue(admin.sessionCookie, event.id);
    const old = await prisma.certificate.findFirstOrThrow({ where: { eventId: event.id } });

    const res = await request(app.getHttpServer())
      .post(`${API_PREFIX}/certificates/${old.id}/reissue`)
      .set('Cookie', admin.sessionCookie)
      .send({ reason: 'Holder name corrected in the registry' });
    expect(res.status).toBe(200);

    const rows = await prisma.notification.findMany({ where: { userId: attendee.userId } });
    expect(rows.filter((r) => r.type === 'certificate.revoked')).toHaveLength(1);
    // Two issued rows, the first from the original issuance: the dedupe key is
    // per certificate id, so the replacement is not absorbed by the first.
    const issued = rows.filter((r) => r.type === 'certificate.issued');
    expect(issued).toHaveLength(2);
    expect(issued.map((r) => r.dedupeKey)).toContain(`certificate.issued:${res.body.id}`);
  });
});

describe('snapshots', () => {
  it('survive a club rename', async () => {
    const { event, club } = await aCertifiableEvent();
    const admin = await loginAsAdmin(app);
    await issue(admin.sessionCookie, event.id);
    const certificate = await prisma.certificate.findFirstOrThrow({ where: { eventId: event.id } });

    await prisma.club.update({ where: { id: club.id }, data: { name: 'Something Else Entirely' } });

    expect((await verify(certificate.verificationCode)).body.clubName).toBe(club.name);
  });
});
