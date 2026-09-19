import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestPrisma, disconnectTestPrisma, truncateAll } from '../db';
import { mkClub, mkUser, uniq } from '../factories';

const prisma = createTestPrisma();

afterAll(async () => { await disconnectTestPrisma(prisma); });
beforeEach(async () => { await truncateAll(prisma); });

const at = (h: number) => new Date(Date.now() + h * 3_600_000);

async function aRegistration() {
  const club = await mkClub();
  const creator = await mkUser();
  const event = await prisma.event.create({
    data: {
      clubId: club.id,
      title: 'Workshop',
      slug: uniq('event'),
      summary: 's',
      description: 'd',
      eventType: 'WORKSHOP',
      audience: 'ALL_STUDENTS',
      startsAt: at(24),
      endsAt: at(26),
      registrationOpensAt: at(1),
      registrationClosesAt: at(23),
      capacity: 10,
      certificateEnabled: true,
      createdById: creator.id,
    },
  });
  const user = await mkUser();
  const registration = await prisma.eventRegistration.create({
    data: { eventId: event.id, userId: user.id, status: 'CONFIRMED' },
  });
  return { club, event, user, registration };
}

describe('QrPass', () => {
  it('is one per user and starts at version 1', async () => {
    const user = await mkUser();
    const pass = await prisma.qrPass.create({ data: { userId: user.id } });
    expect(pass.tokenVersion).toBe(1);
  });

  it('rejects a second pass for the same user', async () => {
    const user = await mkUser();
    await prisma.qrPass.create({ data: { userId: user.id } });
    await expect(prisma.qrPass.create({ data: { userId: user.id } }))
      .rejects.toMatchObject({ code: 'P2002' });
  });

  it('stores no token column at all, only the version', async () => {
    const cols = await prisma.$queryRaw<{ column_name: string }[]>`
      SELECT column_name FROM information_schema.columns WHERE table_name = 'qr_pass'`;
    // The EXACT column set, not a substring match on "token": a raw secret named
    // `signature`, `qr_secret` or `raw_code` sails past a substring check, and
    // this is the only automated defence of the no-raw-token guarantee.
    expect(cols.map((c) => c.column_name).sort()).toEqual([
      'id',
      'issued_at',
      'last_rotated_at',
      'token_version',
      'user_id',
    ]);
  });
});

describe('AttendanceRecord', () => {
  it('records a check-in with the scanner and method', async () => {
    const { event, user, registration } = await aRegistration();
    const scanner = await mkUser();
    const record = await prisma.attendanceRecord.create({
      data: {
        registrationId: registration.id,
        eventId: event.id,
        userId: user.id,
        checkedInById: scanner.id,
        method: 'QR_SCAN',
      },
    });
    expect(record.method).toBe('QR_SCAN');
    expect(record.checkedInAt).toBeInstanceOf(Date);
  });

  it('scopes attendance per registration, not per event: a queue of students all check in', async () => {
    // Catches a unique index on event_id instead of registration_id, which
    // passes every other test here while allowing one check-in per event, ever.
    const { event, user, registration } = await aRegistration();
    const scanner = await mkUser();
    await prisma.attendanceRecord.create({
      data: { registrationId: registration.id, eventId: event.id, userId: user.id, checkedInById: scanner.id, method: 'QR_SCAN' },
    });

    const second = await mkUser();
    const secondReg = await prisma.eventRegistration.create({
      data: { eventId: event.id, userId: second.id, status: 'CONFIRMED' },
    });

    await expect(
      prisma.attendanceRecord.create({
        data: { registrationId: secondReg.id, eventId: event.id, userId: second.id, checkedInById: scanner.id, method: 'QR_SCAN' },
      }),
    ).resolves.toBeDefined();
  });

  it('scopes attendance per registration, not per user: one student attends two events', async () => {
    // The mirror: a unique index on user_id lets a student check in to one event
    // ever, and every other test here passes either way.
    const first = await aRegistration();
    const scanner = await mkUser();
    await prisma.attendanceRecord.create({
      data: {
        registrationId: first.registration.id,
        eventId: first.event.id,
        userId: first.user.id,
        checkedInById: scanner.id,
        method: 'QR_SCAN',
      },
    });

    const second = await aRegistration();
    const secondReg = await prisma.eventRegistration.create({
      data: { eventId: second.event.id, userId: first.user.id, status: 'CONFIRMED' },
    });

    await expect(
      prisma.attendanceRecord.create({
        data: {
          registrationId: secondReg.id,
          eventId: second.event.id,
          userId: first.user.id,
          checkedInById: scanner.id,
          method: 'QR_SCAN',
        },
      }),
    ).resolves.toBeDefined();
  });

  it('makes a double check-in impossible, even from two simultaneous scanners', async () => {
    const { event, user, registration } = await aRegistration();
    const scanner = await mkUser();
    const data = {
      registrationId: registration.id,
      eventId: event.id,
      userId: user.id,
      checkedInById: scanner.id,
      method: 'QR_SCAN' as const,
    };
    await prisma.attendanceRecord.create({ data });
    await expect(prisma.attendanceRecord.create({ data })).rejects.toMatchObject({ code: 'P2002' });
  });

  it('refuses to delete a registration that has an attendance record', async () => {
    // registration is Restrict, not Cascade: deleting one would destroy the
    // proof that a person was in the room.
    const { user, event, registration } = await aRegistration();
    const scanner = await mkUser();
    await prisma.attendanceRecord.create({
      data: { registrationId: registration.id, eventId: event.id, userId: user.id, checkedInById: scanner.id, method: 'QR_SCAN' },
    });

    await expect(
      prisma.eventRegistration.delete({ where: { id: registration.id } }),
    ).rejects.toMatchObject({ code: 'P2003' });
  });
});

describe('Certificate', () => {
  function certData<T extends Record<string, unknown>>(over: T) {
    return {
      serialNumber: uniq('MJL'),
      verificationCode: uniq('VC').replace(/[^A-Z0-9]/gi, '').toUpperCase(),
      holderNameSnapshot: 'Layla Hassan',
      eventTitleSnapshot: 'Workshop',
      clubNameSnapshot: 'Robotics Club',
      clubLogoSnapshotUrl: 'https://example.test/logo.png',
      ...over,
    };
  }

  it('snapshots holder, event, club and logo at issuance', async () => {
    const { event, user, registration } = await aRegistration();
    const cert = await prisma.certificate.create({
      data: certData({ registrationId: registration.id, eventId: event.id, userId: user.id }),
    });
    expect(cert.status).toBe('ACTIVE');
    expect(cert.clubLogoSnapshotUrl).toBe('https://example.test/logo.png');
    expect(cert.pdfUrl).toBeNull(); // rendered lazily on first download
  });

  it('scopes certificates per registration: two attendees of one event each get one', async () => {
    const { event, user, registration } = await aRegistration();
    await prisma.certificate.create({
      data: certData({ registrationId: registration.id, eventId: event.id, userId: user.id }),
    });

    const second = await mkUser();
    const secondReg = await prisma.eventRegistration.create({
      data: { eventId: event.id, userId: second.id, status: 'CONFIRMED' },
    });

    await expect(
      prisma.certificate.create({
        data: certData({ registrationId: secondReg.id, eventId: event.id, userId: second.id }),
      }),
    ).resolves.toBeDefined();
  });

  it('scopes active certificates per registration, not per student: one student attends two events', async () => {
    // Catches a unique index on user_id instead of registration_id, which allows
    // one active certificate per student ever and passes every other test here,
    // since aRegistration() mints a fresh user each call.
    const first = await aRegistration();
    await prisma.certificate.create({
      data: certData({
        registrationId: first.registration.id,
        eventId: first.event.id,
        userId: first.user.id,
      }),
    });

    const second = await aRegistration();
    const secondReg = await prisma.eventRegistration.create({
      data: { eventId: second.event.id, userId: first.user.id, status: 'CONFIRMED' },
    });

    await expect(
      prisma.certificate.create({
        data: certData({
          registrationId: secondReg.id,
          eventId: second.event.id,
          userId: first.user.id,
        }),
      }),
    ).resolves.toBeDefined();
  });

  it('rejects a second ACTIVE certificate for one registration, so re-running issuance is safe', async () => {
    const { event, user, registration } = await aRegistration();
    const base = { registrationId: registration.id, eventId: event.id, userId: user.id };
    await prisma.certificate.create({ data: certData(base) });
    await expect(prisma.certificate.create({ data: certData(base) }))
      .rejects.toMatchObject({ code: 'P2002' });
  });

  it('allows a reissue once the previous certificate is REVOKED, keeping both verifiable', async () => {
    const { event, user, registration } = await aRegistration();
    const base = { registrationId: registration.id, eventId: event.id, userId: user.id };
    const first = await prisma.certificate.create({ data: certData(base) });
    await prisma.certificate.update({
      where: { id: first.id },
      data: { status: 'REVOKED', revokedAt: new Date(), revokedReason: 'Name corrected' },
    });
    await expect(prisma.certificate.create({ data: certData(base) })).resolves.toBeDefined();
    expect(await prisma.certificate.count()).toBe(2);
  });

  it('rejects a duplicate serial number', async () => {
    // serial_number is the human-facing identifier and is @unique exactly as
    // verification_code is, so both symmetric guarantees need covering.
    const a = await aRegistration();
    const b = await aRegistration();
    const serial = 'MJL-SHARED-0001';

    await prisma.certificate.create({
      data: certData({
        registrationId: a.registration.id,
        eventId: a.event.id,
        userId: a.user.id,
        serialNumber: serial,
      }),
    });

    await expect(
      prisma.certificate.create({
        data: certData({
          registrationId: b.registration.id,
          eventId: b.event.id,
          userId: b.user.id,
          serialNumber: serial,
        }),
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('rejects a duplicate verification code', async () => {
    const a = await aRegistration();
    const b = await aRegistration();
    const code = 'SHAREDCODE123';
    await prisma.certificate.create({
      data: certData({ registrationId: a.registration.id, eventId: a.event.id, userId: a.user.id, verificationCode: code }),
    });
    await expect(
      prisma.certificate.create({
        data: certData({ registrationId: b.registration.id, eventId: b.event.id, userId: b.user.id, verificationCode: code }),
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('refuses to delete a registration that has an active certificate', async () => {
    const { event, user, registration } = await aRegistration();
    await prisma.certificate.create({
      data: certData({ registrationId: registration.id, eventId: event.id, userId: user.id }),
    });

    await expect(
      prisma.eventRegistration.delete({ where: { id: registration.id } }),
    ).rejects.toMatchObject({ code: 'P2003' });
  });
});
