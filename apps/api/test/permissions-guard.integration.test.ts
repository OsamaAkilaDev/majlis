import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SESSION_COOKIE } from '../src/auth/cookies';
import { resolveClubFacts, resolveEventFacts, PermissionsGuard } from '../src/auth/permissions.guard';
import { TokensService } from '../src/auth/tokens.service';
import { API_PREFIX } from '../src/config/api-prefix';
import { TransactionHost } from '../src/prisma/transaction.host';
import { createTestApp } from './app';
import { createTestPrisma, disconnectTestPrisma, truncateAll } from './db';
import { aUser, mkAppointment, mkClub, mkUser, uniq } from './factories';
import { ScopedTestModule } from './fixtures/scoped.controller';

const prisma = createTestPrisma();
const CLUB_EDIT_PATH = (clubId: string) => `${API_PREFIX}/__test/clubs/${clubId}/edit`;
const USER_STATUS_PATH = (id: string) => `${API_PREFIX}/__test/users/${id}/status`;

let app: INestApplication;
let tokens: TokensService;
let host: TransactionHost;

beforeAll(async () => {
  app = await createTestApp([ScopedTestModule]);
  tokens = app.get(TokensService);
  host = app.get(TransactionHost);
});

afterAll(async () => {
  await app.close();
  await disconnectTestPrisma(prisma);
});

beforeEach(async () => {
  await truncateAll(prisma);
});

async function sessionCookieFor(userId: string): Promise<string> {
  const token = await tokens.signAccessToken(userId);
  return `${SESSION_COOKIE}=${token}`;
}

const at = (hoursFromNow: number) => new Date(Date.now() + hoursFromNow * 3_600_000);

/** Bare-minimum Event row. */
async function anEvent(clubId: string, createdById: string) {
  return prisma.event.create({
    data: {
      clubId,
      title: `Event ${uniq('event')}`,
      slug: uniq('event'),
      summary: 'A summary.',
      description: 'A description.',
      eventType: 'WORKSHOP',
      audience: 'ALL_STUDENTS',
      venue: 'Hall A',
      startsAt: at(24),
      endsAt: at(26),
      registrationOpensAt: at(1),
      registrationClosesAt: at(23),
      checkInOpensAt: at(23),
      checkInClosesAt: at(26.5),
      capacity: 2,
      createdById,
    },
  });
}

describe('PermissionsGuard: HTTP', () => {
  it('denies a non-admin and records the denial, and the write does not happen', async () => {
    // Catches a guard that denies but records nothing, and separately one that
    // records the denial and lets the write through.
    const student = await mkUser(); // platformRole defaults to STUDENT
    const cookie = await sessionCookieFor(student.id);
    const target = await prisma.user.create({ data: aUser() });

    const res = await request(app.getHttpServer())
      .patch(USER_STATUS_PATH(target.id))
      .set('Cookie', cookie)
      .send({ status: 'SUSPENDED' });

    expect(res.status).toBe(403);
    // Guards run outside some Nest pipelines, so this pins that a guard's
    // ForbiddenError still reaches ProblemExceptionFilter.
    expect(res.headers['content-type']).toMatch(/application\/problem\+json/);

    const rows = await prisma.auditLog.findMany({ where: { entityId: target.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.action).toBe('permission.denied');
    expect(rows[0]?.outcome).toBe('DENIED');
    expect(rows[0]?.actorUserId).toBe(student.id);

    expect(await prisma.user.findUniqueOrThrow({ where: { id: target.id } })).toMatchObject({
      status: 'ACTIVE',
    });
  });

  it('allows an ADMIN through the same route, and the write happens', async () => {
    // Positive control: a guard that denies everything passes the test above.
    const admin = await mkUser({ platformRole: 'ADMIN' });
    const cookie = await sessionCookieFor(admin.id);
    const target = await prisma.user.create({ data: aUser() });

    const res = await request(app.getHttpServer())
      .patch(USER_STATUS_PATH(target.id))
      .set('Cookie', cookie)
      .send({ status: 'SUSPENDED' });

    expect(res.status).toBe(200);
    expect(await prisma.user.findUniqueOrThrow({ where: { id: target.id } })).toMatchObject({
      status: 'SUSPENDED',
    });
    expect(await prisma.auditLog.count({ where: { entityId: target.id } })).toBe(0);
  });

  it('grants club scope over HTTP to a LEAD in that club, and denies a non-member', async () => {
    const lead = await mkUser();
    const outsider = await mkUser();
    const club = await mkClub();
    await mkAppointment({ userId: lead.id, clubId: club.id, role: 'LEAD', status: 'ACTIVE' });

    const leadRes = await request(app.getHttpServer())
      .get(CLUB_EDIT_PATH(club.id))
      .set('Cookie', await sessionCookieFor(lead.id));
    expect(leadRes.status).toBe(200);

    const outsiderRes = await request(app.getHttpServer())
      .get(CLUB_EDIT_PATH(club.id))
      .set('Cookie', await sessionCookieFor(outsider.id));
    expect(outsiderRes.status).toBe(403);
  });

  it('denies rather than 500s when the scope path in the decorator is unresolvable', async () => {
    // `broken-scope` is a route the router genuinely matches (an empty `:clubId`
    // segment never matches, so the guard would not run at all), and its `from`
    // points at `params.missing.deeper`. Catches readAt missing its
    // `typeof acc !== 'object'` guard, which throws a TypeError and 500s.
    const user = await mkUser(); // STUDENT, no club roles: evaluate() must deny
    const club = await mkClub();
    const res = await request(app.getHttpServer())
      .get(`${API_PREFIX}/__test/clubs/${club.id}/broken-scope`)
      .set('Cookie', await sessionCookieFor(user.id));
    expect(res.status).toBe(403);
  });
});

describe('resolveClubFacts', () => {
  it('grants club scope only in the club the appointment is in', async () => {
    // Two users and two clubs: a resolver ignoring its userId argument passes a
    // single-user fixture, and is caught by the bob/clubA assertion.
    const alice = await mkUser();
    const bob = await mkUser();
    const clubA = await mkClub();
    const clubB = await mkClub();
    await mkAppointment({ userId: alice.id, clubId: clubA.id, role: 'LEAD', status: 'ACTIVE' });

    expect(await resolveClubFacts(host, alice.id, clubA.id)).toMatchObject({ clubRoles: ['LEAD'] });
    expect(await resolveClubFacts(host, alice.id, clubB.id)).toMatchObject({ clubRoles: [] });
    expect(await resolveClubFacts(host, bob.id, clubA.id)).toMatchObject({ clubRoles: [] });
  });

  it('ignores an appointment that is not ACTIVE', async () => {
    // Catches a resolver querying appointments without filtering on status,
    // which grants full Lead authority to anyone INVITED, or who DECLINED.
    const alice = await mkUser();
    const clubA = await mkClub();
    for (const status of ['INVITED', 'DECLINED', 'EXPIRED', 'ENDED'] as const) {
      await prisma.clubTeamAppointment.deleteMany({});
      await mkAppointment({ userId: alice.id, clubId: clubA.id, role: 'LEAD', status });
      expect(await resolveClubFacts(host, alice.id, clubA.id), status).toMatchObject({ clubRoles: [] });
    }
  });
});

describe('resolveEventFacts', () => {
  it('grants event scope only for the event the assignment is on', async () => {
    // Two users and two events, as in the club test: catches a resolver ignoring
    // its userId or eventId argument.
    const alice = await mkUser();
    const bob = await mkUser();
    const club = await mkClub();
    const eventA = await anEvent(club.id, alice.id);
    const eventB = await anEvent(club.id, alice.id);
    await prisma.eventAssignment.create({
      data: { eventId: eventA.id, userId: alice.id, responsibility: 'EVENT_LEAD', assignedById: alice.id },
    });

    expect(await resolveEventFacts(host, alice.id, eventA.id)).toMatchObject({
      eventResponsibilities: ['EVENT_LEAD'],
    });
    expect(await resolveEventFacts(host, alice.id, eventB.id)).toMatchObject({
      eventResponsibilities: [],
    });
    expect(await resolveEventFacts(host, bob.id, eventA.id)).toMatchObject({
      eventResponsibilities: [],
    });
  });
});

describe('PermissionsGuard.loadFacts: event scope also carries the event\'s club authority', () => {
  it('grants a club LEAD authority over an event in their own club with no per-event assignment', async () => {
    // A club's officers hold authority over its events with no EventAssignment
    // row. Catches a resolver querying only EventAssignment, which silently
    // denies a club Lead acting on their own club's event.
    const lead = await mkUser();
    const club = await mkClub();
    const event = await anEvent(club.id, lead.id);
    await mkAppointment({ userId: lead.id, clubId: club.id, role: 'LEAD', status: 'ACTIVE' });

    const guard = app.get(PermissionsGuard);
    const facts = await guard.loadFacts(lead, { scope: 'event', from: 'params.eventId' }, event.id);

    expect(facts.clubRoles).toEqual(['LEAD']);
    expect(facts.eventResponsibilities).toEqual([]);
  });

  it('resolves to no authority, not a throw, for an event id that does not exist', async () => {
    const user = await mkUser();
    const guard = app.get(PermissionsGuard);

    await expect(
      guard.loadFacts(user, { scope: 'event', from: 'params.eventId' }, '00000000-0000-7000-8000-000000000000'),
    ).resolves.toMatchObject({ clubRoles: [], eventResponsibilities: [] });
  });
});
