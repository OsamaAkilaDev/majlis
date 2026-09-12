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

// Stubbed at the module level so no test in this file touches Supabase, same
// fake as clubs-create.integration.test.ts.
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
    // Catches a handler that writes the audit row without the reason, which
    // is what makes an override reviewable at all.
    expect(rows[0]!.reason).toBe('Inactive all semester.');
  });

  it('refuses any transition out of ARCHIVED, leaving status unchanged', async () => {
    const admin = await loginAsAdmin(app);
    const club = await makeClub({ status: 'ARCHIVED' });

    expect((await patchClubStatus(admin.sessionCookie, club.id, 'ACTIVE', 'Revive.')).status).toBe(422);
    // Catches a handler that writes the row and only denies the response,
    // which a status-code-only assertion would still pass.
    expect((await prisma.club.findUniqueOrThrow({ where: { id: club.id } })).status).toBe('ARCHIVED');
  });

  it('refuses a Lead of the club, leaving status unchanged', async () => {
    // Catches a rule copied from club:edit. A Lead who can archive their own
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
    // Catches a handler with no @RequirePermission at all, which every
    // happy-path test would still pass.
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
    // This only proves patchClubBodySchema's ZodValidationPipe strips
    // status/slug before the service ever sees the body. Real, but not a
    // statement about the service. Catches the schema switched to
    // passthrough mode, or one that gained a `status` or `slug` key. It
    // would NOT catch a service that spread the (already-stripped) body into
    // Prisma's data, see the service-level test below for that.
    const club = await makeClub();
    const lead = await makeActiveLead(app, club.id);
    await patchClub(lead.sessionCookie, club.id, { status: 'ARCHIVED', slug: 'stolen' });

    const after = await prisma.club.findUniqueOrThrow({ where: { id: club.id } });
    expect(after.status).toBe('ACTIVE');
    expect(after.slug).toBe(club.slug);
  });

  it('ClubsService.update ignores keys outside PatchClubBody even with no validation pipe in the way', async () => {
    // Calls the service directly, bypassing ZodValidationPipe entirely.
    // Fails the moment `update` builds `data` by spreading `body` instead of
    // picking each key explicitly, which is the one thing the test above
    // cannot exercise: Zod never lets a smuggled key reach the service in
    // the first place.
    const club = await makeClub();
    const admin = await loginAsAdmin(app);
    const actor = await prisma.user.findUniqueOrThrow({ where: { id: admin.userId } });
    const clubs = app.get(ClubsService, { strict: false });

    await clubs.update(actor, club.id, { status: 'ARCHIVED', slug: 'stolen', name: 'Renamed' } as never);

    const after = await prisma.club.findUniqueOrThrow({ where: { id: club.id } });
    expect(after.status).toBe('ACTIVE');
    expect(after.slug).toBe(club.slug);
    expect(after.name).toBe(club.name);
  });

  it('refuses a logoUploaded edit with no uploaded object, leaving logoUrl unchanged', async () => {
    // The service must call verifyUpload rather than trust the boolean, or a
    // Lead could flip logoUploaded to true with nothing at that path and the
    // update would silently write a broken image URL.
    const club = await makeClub();
    const lead = await makeActiveLead(app, club.id);
    // Deliberately do not populate `uploaded`.

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
    // Catches a route missing @RequirePermission entirely, or one scoped to
    // the wrong param name (see clubs.controller.ts's clubId requirement).
    const club = await makeClub();
    const member = await loginAsStudent(app);

    const res = await request(app.getHttpServer())
      .post(`${CLUBS_PATH}/${club.id}/${kind}-upload-url`)
      .set('Cookie', member.sessionCookie);

    expect(res.status).toBe(403);
  });
});
