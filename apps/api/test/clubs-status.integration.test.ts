import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ClubsService } from '../src/clubs/clubs.service';
import { API_PREFIX } from '../src/config/api-prefix';
import { StorageService } from '../src/storage/storage.service';
import { createTestApp } from './app';
import { loginAsAdmin, loginAsStudent } from './auth-helpers';
import { createTestPrisma, disconnectTestPrisma, truncateAll } from './db';
import { makeActiveLead, makeClub } from './factories';

const CLUBS_PATH = `${API_PREFIX}/clubs`;

const prisma = createTestPrisma();
let app: INestApplication;

/** What the fake storage backend has "received" bytes for, keyed by object path. */
const uploaded = new Map<string, { size: number; contentType: string }>();

// Stubbed so no test in this file touches Supabase.
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

/** PATCHes /clubs/:clubId/status as whoever `cookie` belongs to. */
function patchClubStatus(cookie: string, clubId: string, status: string, reason: string): request.Test {
  return request(app.getHttpServer())
    .patch(`${CLUBS_PATH}/${clubId}/status`)
    .set('Cookie', cookie)
    .send({ status, reason });
}

/** PATCHes /clubs/:clubId as whoever `cookie` belongs to. */
function patchClub(cookie: string, clubId: string, body: Record<string, unknown>): request.Test {
  return request(app.getHttpServer()).patch(`${CLUBS_PATH}/${clubId}`).set('Cookie', cookie).send(body);
}

describe('PATCH /clubs/:clubId/status', () => {
  it('suspends and reactivates, writing an audit row each time', async () => {
    const admin = await loginAsAdmin(app);
    const club = await makeClub();

    expect(
      (await patchClubStatus(admin.sessionCookie, club.id, 'SUSPENDED', 'Inactive all semester.')).status,
    ).toBe(200);
    expect(
      (await patchClubStatus(admin.sessionCookie, club.id, 'ACTIVE', 'Back in operation.')).status,
    ).toBe(200);

    const rows = await prisma.auditLog.findMany({ where: { entityId: club.id }, orderBy: { createdAt: 'asc' } });
    expect(rows.map((r) => r.action)).toEqual(['club.suspended', 'club.reactivated']);
    // Catches an audit row written without the reason, which is what makes an
    // override reviewable.
    expect(rows[0]!.reason).toBe('Inactive all semester.');
  });

  it('revives an ARCHIVED club, which is no longer terminal', async () => {
    // ARCHIVED is not terminal: a misclick must have a route back. Asserts the
    // row, so a handler answering 200 without writing fails.
    const admin = await loginAsAdmin(app);
    const club = await makeClub({ status: 'ARCHIVED' });

    expect((await patchClubStatus(admin.sessionCookie, club.id, 'ACTIVE', 'Revive.')).status).toBe(200);
    expect((await prisma.club.findUniqueOrThrow({ where: { id: club.id } })).status).toBe('ACTIVE');
  });

  it('still refuses a transition to the status it already holds', async () => {
    // The only rule left in a fully connected table, and all that stands between
    // assertTransition and a no-op audit row.
    const admin = await loginAsAdmin(app);
    const club = await makeClub({ status: 'ARCHIVED' });

    expect((await patchClubStatus(admin.sessionCookie, club.id, 'ARCHIVED', 'Again.')).status).toBe(422);
    expect((await prisma.club.findUniqueOrThrow({ where: { id: club.id } })).status).toBe('ARCHIVED');
  });

  it('refuses a Lead of the club, leaving status unchanged', async () => {
    // Catches a rule copied from club:edit: a Lead who can archive their own
    // club has escaped the governance model.
    const club = await makeClub();
    const lead = await makeActiveLead(app, club.id);
    expect((await patchClubStatus(lead.sessionCookie, club.id, 'SUSPENDED', 'Mine now.')).status).toBe(403);
    expect((await prisma.club.findUniqueOrThrow({ where: { id: club.id } })).status).toBe('ACTIVE');
  });

  it('requires a reason', async () => {
    const admin = await loginAsAdmin(app);
    const club = await makeClub();
    const res = await request(app.getHttpServer())
      .patch(`${CLUBS_PATH}/${club.id}/status`)
      .set('Cookie', admin.sessionCookie)
      .send({ status: 'SUSPENDED' });
    expect(res.status).toBe(400);
  });
});

describe('PATCH /clubs/:clubId', () => {
  it('lets a Lead edit and refuses a plain member', async () => {
    const club = await makeClub();
    const lead = await makeActiveLead(app, club.id);
    const member = await loginAsStudent(app);
    await prisma.clubMembership.create({ data: { clubId: club.id, userId: member.userId, status: 'ACTIVE' } });

    expect((await patchClub(lead.sessionCookie, club.id, { category: 'Engineering' })).status).toBe(200);
    // Catches a handler with no @RequirePermission, which every happy path passes.
    expect((await patchClub(member.sessionCookie, club.id, { category: 'Engineering' })).status).toBe(403);
  });

  it('refuses to edit an archived club but allows a suspended one', async () => {
    const archived = await makeClub({ status: 'ARCHIVED' });
    const archivedLead = await makeActiveLead(app, archived.id);
    expect((await patchClub(archivedLead.sessionCookie, archived.id, { category: 'XX' })).status).toBe(422);

    const suspended = await makeClub({ status: 'SUSPENDED' });
    const suspendedLead = await makeActiveLead(app, suspended.id);
    expect((await patchClub(suspendedLead.sessionCookie, suspended.id, { category: 'XX' })).status).toBe(200);
  });

  it('the validation pipe strips keys the edit schema does not declare', async () => {
    // Catches the schema switched to passthrough, or one that gained a `status`
    // or `slug` key. It would not catch a service spreading the body into
    // Prisma's data: the service-level test below does that.
    const club = await makeClub();
    const lead = await makeActiveLead(app, club.id);
    await patchClub(lead.sessionCookie, club.id, { status: 'ARCHIVED', slug: 'stolen' });

    const after = await prisma.club.findUniqueOrThrow({ where: { id: club.id } });
    expect(after.status).toBe('ACTIVE');
    expect(after.slug).toBe(club.slug);
  });

  it('ClubsService.update ignores keys outside PatchClubBody even with no validation pipe in the way', async () => {
    // Calls the service directly, bypassing ZodValidationPipe, so it fails the
    // moment `update` builds `data` by spreading `body`. The test above cannot:
    // Zod never lets a smuggled key reach the service.
    const club = await makeClub();
    const admin = await loginAsAdmin(app);
    const actor = await prisma.user.findUniqueOrThrow({ where: { id: admin.userId } });
    const clubs = app.get(ClubsService, { strict: false });

    // overrideReason is required of a club-roleless Admin, and is not one of the
    // smuggled keys under test.
    await clubs.update(actor, club.id, {
      status: 'ARCHIVED',
      slug: 'stolen',
      name: 'Renamed',
      overrideReason: 'Test override.',
    } as never);

    const after = await prisma.club.findUniqueOrThrow({ where: { id: club.id } });
    expect(after.status).toBe('ACTIVE');
    expect(after.slug).toBe(club.slug);
    expect(after.name).toBe(club.name);
  });

  it('refuses a logoUploaded edit with no uploaded object, leaving logoUrl unchanged', async () => {
    // Catches a service trusting the boolean instead of calling verifyUpload: a
    // Lead could flip logoUploaded with nothing at that path, writing a broken
    // image URL.
    const club = await makeClub();
    const lead = await makeActiveLead(app, club.id);
    // `uploaded` is deliberately left empty.

    const res = await patchClub(lead.sessionCookie, club.id, { logoUploaded: true });
    expect(res.status).toBe(422);

    const after = await prisma.club.findUniqueOrThrow({ where: { id: club.id } });
    expect(after.logoUrl).toBe(club.logoUrl);
  });
});

describe.each(['logo', 'banner'] as const)('POST /clubs/:clubId/%s-upload-url', (kind) => {
  it('lets a Lead mint an upload URL for their own club', async () => {
    const club = await makeClub();
    const lead = await makeActiveLead(app, club.id);

    const res = await request(app.getHttpServer())
      .post(`${CLUBS_PATH}/${club.id}/${kind}-upload-url`)
      .set('Cookie', lead.sessionCookie);

    expect(res.status).toBe(201);
    expect(res.body.path).toBe(`clubs/${club.id}/${kind}.webp`);
  });

  it('refuses a plain member', async () => {
    // Catches a route missing @RequirePermission, or one scoped to the wrong
    // param name.
    const club = await makeClub();
    const member = await loginAsStudent(app);

    const res = await request(app.getHttpServer())
      .post(`${CLUBS_PATH}/${club.id}/${kind}-upload-url`)
      .set('Cookie', member.sessionCookie);

    expect(res.status).toBe(403);
  });
});

describe('POST /clubs/:clubId/logo-upload-url', () => {
  // The mint overwrites the live public logo object, so it takes PATCH's status
  // gate. Catches a mint route with no gate, the one way an officer of an
  // archived club could still replace its public logo.
  it('refuses an archived club and records the mint it allows', async () => {
    const archived = await makeClub({ status: 'ARCHIVED' });
    const archivedLead = await makeActiveLead(app, archived.id);
    const refused = await request(app.getHttpServer())
      .post(`${CLUBS_PATH}/${archived.id}/logo-upload-url`)
      .set('Cookie', archivedLead.sessionCookie);

    expect(refused.status).toBe(422);
    expect(refused.body.detail).toBe('That club is archived.');

    const live = await makeClub();
    const lead = await makeActiveLead(app, live.id);
    const allowed = await request(app.getHttpServer())
      .post(`${CLUBS_PATH}/${live.id}/logo-upload-url`)
      .set('Cookie', lead.sessionCookie);

    expect(allowed.status).toBe(201);
    // The bytes never pass through the API, so this row is the only record the
    // object was replaced.
    const rows = await prisma.auditLog.findMany({ where: { entityId: live.id, action: 'club.upload_url_minted' } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.actorUserId).toBe(lead.userId);
    // Nothing is recorded for the refusal: that transaction rolled back.
    expect(
      await prisma.auditLog.count({ where: { entityId: archived.id, action: 'club.upload_url_minted' } }),
    ).toBe(0);
  });
});
