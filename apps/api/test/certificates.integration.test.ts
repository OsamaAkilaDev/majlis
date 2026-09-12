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
/** Matches ATTENDANCE_CORRECTION_WINDOW_HOURS' default. */
const WINDOW_HOURS = 48;

/**
 * Bytes the API produced, keyed by object path, with the bucket they were
 * sent to. The bucket is recorded because it is a security property and not
 * a detail: a certificate written to the public bucket is readable at
 * /object/public/<path> with no cookie, and signing its URL does not change
 * that. An earlier version of this fake dropped the argument, which made the
 * wiring untestable and let a mutation that reverted it stay green.
 */
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

/**
 * An event that finished long enough ago for its correction window to have
 * closed, with one student who was checked in and one who was not.
 */
async function aCertifiableEvent(overrides: Record<string, unknown> = {}) {
  const now = Date.now();
  const endedAt = now - (WINDOW_HOURS + 1) * HOUR;
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
    checkInOpensAt: new Date(endedAt - 3 * HOUR),
    checkInClosesAt: new Date(endedAt + HOUR),
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
    // All four snapshot columns, filled at issuance. A certificate that
    // joined to the club at read time would be rewritten by a rename.
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
    // Spec 7.6: idempotent. The partial unique index on registration_id
    // WHERE status = 'ACTIVE' is the guarantee; a second run must be a no-op
    // rather than a duplicate or an error.
    const { event } = await aCertifiableEvent();
    const admin = await loginAsAdmin(app);

    const first = await issue(admin.sessionCookie, event.id);
    const second = await issue(admin.sessionCookie, event.id);

    expect(first.body).toEqual({ issued: 1, total: 1 });
    expect(second.body).toEqual({ issued: 0, total: 1 });
    expect(await prisma.certificate.count({ where: { eventId: event.id } })).toBe(1);
    // And no second CERTIFIED audit row for a transition that did not happen.
    expect(await prisma.auditLog.count({ where: { action: 'certificate.issued_for_event' } })).toBe(1);
  });

  it('gives a NO_SHOW nothing', async () => {
    const { event, absentee } = await aCertifiableEvent();
    const admin = await loginAsAdmin(app);

    await issue(admin.sessionCookie, event.id);

    expect(await prisma.certificate.count({ where: { userId: absentee.userId } })).toBe(0);
  });

  it('refuses while the attendance correction window is still open', async () => {
    // Issuing at COMPLETED would make spec 7.5's 48 hours for correcting
    // attendance zero, because 7.6 locks attendance at CERTIFIED.
    const now = Date.now();
    const { event } = await aCertifiableEvent({
      startsAt: new Date(now - 4 * HOUR),
      endsAt: new Date(now - 2 * HOUR),
      checkInClosesAt: new Date(now - HOUR),
    });
    const admin = await loginAsAdmin(app);

    const res = await issue(admin.sessionCookie, event.id);

    expect(res.status).toBe(422);
    expect(res.body.detail).toBe(
      'Certificates are issued once the attendance correction window has closed.',
    );
    expect(await prisma.certificate.count({ where: { eventId: event.id } })).toBe(0);
  });

  it('refuses a club Lead, because spec 6.1 ticks nobody but Admin', async () => {
    const { lead, event } = await aCertifiableEvent();

    const res = await issue(lead.sessionCookie, event.id);

    expect(res.status).toBe(403);
    expect(res.body.detail).toBe('You do not have permission to do that.');
    expect(await prisma.certificate.count({ where: { eventId: event.id } })).toBe(0);
    const denied = await prisma.auditLog.findMany({ where: { outcome: 'DENIED' } });
    expect(denied[0]?.reason).toBe('certificate:manage');
  });
});

describe('the lifecycle sweep', () => {
  it('is what actually issues, because completion and issuance are 48 hours apart', async () => {
    // An event reaches COMPLETED when its check-in window shuts and cannot
    // issue until the correction window closes two days later, so no status
    // advance is ever also an issuance. Without a path that looks for events
    // already sitting in COMPLETED, certificates would only ever appear when
    // somebody happened to open the event page afterwards.
    const { event } = await aCertifiableEvent();

    const res = await request(app.getHttpServer())
      .post(`${API_PREFIX}/internal/lifecycle-sweep`)
      .set(SWEEP_SECRET_HEADER, process.env.LIFECYCLE_SWEEP_SECRET ?? EXAMPLE_LIFECYCLE_SWEEP_SECRET);

    expect(res.status).toBe(200);
    expect(res.body.certificatesIssued).toBe(1);
    expect((await prisma.event.findUniqueOrThrow({ where: { id: event.id } })).status).toBe('CERTIFIED');
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
    // The object path is a pure function of the certificate id, and every
    // holder of registration:read can list those ids. A public URL here
    // makes the ownership check below decorative: anyone who can read the
    // listing reads every student's credential document with no cookie.
    expect(first.body.pdfUrl).not.toContain('/object/public/');
    expect(first.body.pdfUrl).toContain('/object/sign/');
    expect(first.body.pdfUrl).toContain('token=');
    expect(signed).toEqual([
      { path: `certificates/${certificate.id}/certificate.pdf`, bucket: CERTIFICATE_BUCKET },
    ]);
    // Signing alone closes nothing. majlis-storage is a PUBLIC bucket, so a
    // certificate written there stays readable at /object/public/<path> with
    // no cookie no matter how the API hands the URL out. Only a bucket that
    // refuses the unsigned path fixes it, so both the bytes and the
    // signature have to be against the private one. Verified live
    // 2026-09-13: anonymous /object/public/ on majlis-certificates answers
    // 400, a signed URL answers 200, a tampered token answers 400.
    const object = uploaded.get(`certificates/${certificate.id}/certificate.pdf`);
    expect(object?.bucket).toBe(CERTIFICATE_BUCKET);
    expect(object?.bucket).not.toBe(STORAGE_BUCKET);
    // A real PDF, not an empty buffer: the render is the thing that can fail
    // silently once the fake storage accepts anything.
    expect(object?.contentType).toBe('application/pdf');
    expect(object?.size).toBeGreaterThan(1000);

    uploaded.clear();
    const second = await request(app.getHttpServer())
      .get(`${API_PREFIX}/certificates/${certificate.id}/pdf`)
      .set('Cookie', attendee.sessionCookie);

    // A second call signs again rather than replaying a stored URL: the
    // first one expires, and a persisted URL would have to be either
    // long-lived or already dead.
    expect(second.body.pdfUrl).not.toBe(first.body.pdfUrl);
    expect(second.body.pdfUrl).toContain('/object/sign/');
    // Rendered once, on the first download. Spec 7.6: issuance stays cheap
    // enough to run inline because it renders nothing.
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
    // Spec 7.6: holder name, event, club, issue date, status, "and nothing
    // else, ever". Pinned exactly, because a widened response on an
    // anonymous route publishes whatever was added to the world.
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
    // Same six keys as an active one. An employer holding a revoked document
    // has to learn that it was revoked, and the reason is not theirs to read.
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

    // The event is CERTIFIED, which assertCorrectable admits for an Admin
    // carrying an override reason. Correcting a mis-scan here used to leave
    // /verify answering ACTIVE, with that student's name, indefinitely.
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

    // Audited in the same transaction as the correction, like every other
    // sensitive action.
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

    // A name correction after issuance is the case spec 7.6 names.
    await prisma.user.update({ where: { id: attendee.userId }, data: { fullName: 'Amina Al Hassan' } });

    const res = await request(app.getHttpServer())
      .post(`${API_PREFIX}/certificates/${old.id}/reissue`)
      .set('Cookie', admin.sessionCookie)
      .send({ reason: 'Holder name corrected in the registry' });

    expect(res.status).toBe(200);
    expect(res.body.holderName).toBe('Amina Al Hassan');
    expect(res.body.serialNumber).not.toBe(old.serialNumber);

    // The partial unique index allows exactly one ACTIVE row per
    // registration, so this only holds if the revoke landed first.
    const rows = await prisma.certificate.findMany({ where: { registrationId: old.registrationId } });
    expect(rows).toHaveLength(2);
    expect(rows.filter((r) => r.status === 'ACTIVE')).toHaveLength(1);

    // Both remain verifiable, which is the point of revoking rather than
    // deleting: the old document is out there on somebody's wall.
    expect((await verify(old.verificationCode)).body.status).toBe('REVOKED');
    expect((await verify(res.body.verificationCode)).body.status).toBe('ACTIVE');
    // And the old row's snapshot still says what it always said.
    expect((await verify(old.verificationCode)).body.holderName).toBe('Amina Hassan');
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
