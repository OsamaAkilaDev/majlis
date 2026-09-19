import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { SESSION_COOKIE } from '../src/auth/cookies';
import { API_PREFIX } from '../src/config/api-prefix';
import type {
  AppointmentStatus,
  Club,
  ClubRole,
  ClubTeamAppointment,
  Event,
  EventRegistration,
  Prisma,
  RegistrationStatus,
  User,
} from '../src/generated/prisma/client';
import { createTestPrisma } from './db';

export type UserSeed = Prisma.UserCreateInput;
export type ClubSeed = Prisma.ClubUncheckedCreateInput;
export type DepartmentSeed = Prisma.DepartmentCreateInput;

/** Unique per call: a fixed string collides within one test, and a setup
 * constraint failure reads like a bug in the code under test. */
export function uniq(prefix: string): string {
  return `${prefix}-${randomUUID().slice(0, 8)}`;
}

/** Seed object, no database write. Email is lowercased because the user table
 * carries CHECK (email = lower(email)); mixed case fails on insert. */
export function aUser(overrides: Partial<UserSeed> = {}): UserSeed {
  const handle = uniq('user');
  return {
    email: `${handle}@uni.ac.ae`.toLowerCase(),
    passwordHash: 'not-a-real-hash-tests-that-log-in-must-set-this',
    fullName: 'Test Person',
    ...overrides,
  };
}

/** A plain seed object: does not touch the database. */
export function aDepartment(overrides: Partial<DepartmentSeed> = {}): DepartmentSeed {
  const handle = uniq('dept');
  return {
    name: `Department ${handle}`,
    code: handle.toUpperCase(),
    ...overrides,
  };
}

/** A plain seed object: does not touch the database. */
export function aClub(departmentId: string, overrides: Partial<ClubSeed> = {}): ClubSeed {
  const handle = uniq('club');
  return {
    departmentId,
    name: `Club ${handle}`,
    slug: `club-${handle}`,
    description: 'A club.',
    category: 'Technology',
    academicYear: '2026/2027',
    logoUrl: 'https://example.test/logo.png',
    ...overrides,
  };
}

// pool: 'forks' with isolate on means one module instance, and so one lazy
// client, per test file. Reclaimed when that worker exits rather than
// disconnected: one extra connection per file for the suite's lifetime.
let db: ReturnType<typeof createTestPrisma> | undefined;
function testDb() {
  db ??= createTestPrisma();
  return db;
}

/** Inserts and returns a User row. */
export function mkUser(overrides: Partial<UserSeed> = {}): Promise<User> {
  return testDb().user.create({ data: aUser(overrides) });
}

/** Inserts a Club, creating its Department too. Pass `departmentId` in
 * overrides to place it in an existing one. */
export async function mkClub(overrides: Partial<ClubSeed> = {}): Promise<Club> {
  const departmentId =
    overrides.departmentId ?? (await testDb().department.create({ data: aDepartment() })).id;
  return testDb().club.create({ data: aClub(departmentId, overrides) });
}

/** Alias, not a second implementation, so the two naming styles cannot drift. */
export const makeClub = mkClub;

export interface AppointmentSeed {
  userId: string;
  clubId: string;
  role: ClubRole;
  status: AppointmentStatus;
}

/** `status` is required with no default: a factory defaulting to ACTIVE would
 * let a permission test that forgot to state it pass against a broken guard.
 * `invitedById` has no foreign key, so self-inviting is harmless. */
export function mkAppointment({
  userId,
  clubId,
  role,
  status,
}: AppointmentSeed): Promise<ClubTeamAppointment> {
  return testDb().clubTeamAppointment.create({
    data: { userId, clubId, role, status, invitedById: userId },
  });
}

/** An INVITED appointment with a live invitationExpiresAt, matching what
 * TeamService.invite produces, without needing an authenticated Lead. */
export function inviteOfficer(clubId: string, userId: string, role: ClubRole): Promise<ClubTeamAppointment> {
  return testDb().clubTeamAppointment.create({
    data: {
      clubId,
      userId,
      role,
      status: 'INVITED',
      invitedById: userId,
      invitationExpiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
    },
  });
}

export interface ActiveLead {
  userId: string;
  sessionCookie: string;
  appointmentId: string;
}

/** Same shape as ActiveLead, kept as a distinct name at the call site for readability. */
export type ActiveOfficer = ActiveLead;

/** Signs up through the real /auth/signup, so `sessionCookie` is a genuine
 * token through SessionGuard. Duplicates loginAsStudent deliberately, and must
 * stay duplicated: auth-helpers imports `uniq` from here, so calling back into
 * it would be a cycle. Do not collapse the two. */
async function signupForAppointment(
  app: INestApplication,
  emailPrefix: string,
  fullName: string,
): Promise<{ userId: string; sessionCookie: string }> {
  const res = await request(app.getHttpServer())
    .post(`${API_PREFIX}/auth/signup`)
    .send({ email: `${uniq(emailPrefix)}@uni.ac.ae`, password: 'correct-horse-battery', fullName });
  if (res.status !== 201) {
    throw new Error(`signupForAppointment: signup failed with ${res.status}: ${JSON.stringify(res.body)}`);
  }
  const userId = (res.body as { id: string }).id;
  const setCookie = res.headers['set-cookie'] as unknown as string[];
  const sessionCookie = setCookie.find((c) => c.startsWith(`${SESSION_COOKIE}=`))!.split(';')[0]!;
  return { userId, sessionCookie };
}

/** Gives a fresh STUDENT an ACTIVE LEAD appointment on `clubId`. */
export async function makeActiveLead(app: INestApplication, clubId: string): Promise<ActiveLead> {
  const { userId, sessionCookie } = await signupForAppointment(app, 'lead', 'Test Lead');
  const appointment = await mkAppointment({ userId, clubId, role: 'LEAD', status: 'ACTIVE' });
  return { userId, sessionCookie, appointmentId: appointment.id };
}

/** Same as makeActiveLead, for any of the four non-Lead officer roles. */
export async function makeActiveOfficer(
  app: INestApplication,
  clubId: string,
  role: ClubRole,
): Promise<ActiveOfficer> {
  const { userId, sessionCookie } = await signupForAppointment(app, 'officer', 'Test Officer');
  const appointment = await mkAppointment({ userId, clubId, role, status: 'ACTIVE' });
  return { userId, sessionCookie, appointmentId: appointment.id };
}

export type EventSeed = Prisma.EventUncheckedCreateInput;
export type RegistrationSeed = Prisma.EventRegistrationUncheckedCreateInput;

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** Seed object, no database write. The window satisfies all four CHECK
 * constraints, so a test can override one and still insert. `status` defaults
 * to PUBLISHED, not the schema's DRAFT: a DRAFT default would make most tests
 * silently exercise the invisible case. */
export function anEvent(clubId: string, createdById: string, overrides: Partial<EventSeed> = {}): EventSeed {
  const handle = uniq('event');
  const now = Date.now();
  return {
    clubId,
    createdById,
    title: `Event ${handle}`,
    slug: `event-${handle}`,
    summary: 'An event.',
    description: 'Something happens.',
    eventType: 'Workshop',
    audience: 'All students',
    venue: 'Hall A',
    startsAt: new Date(now + 7 * DAY),
    endsAt: new Date(now + 7 * DAY + 2 * HOUR),
    registrationOpensAt: new Date(now - DAY),
    registrationClosesAt: new Date(now + 6 * DAY),
    capacity: 30,
    status: 'PUBLISHED',
    ...overrides,
  };
}

/** Inserts and returns an Event row. */
export function mkEvent(
  clubId: string,
  createdById: string,
  overrides: Partial<EventSeed> = {},
): Promise<Event> {
  return testDb().event.create({ data: anEvent(clubId, createdById, overrides) });
}

/** Seed object, no database write. `status` is required for the same reason
 * mkAppointment's is: a waitlist test forgetting it would assert on CONFIRMED. */
export function aRegistration(
  eventId: string,
  userId: string,
  status: RegistrationStatus,
  overrides: Partial<RegistrationSeed> = {},
): RegistrationSeed {
  return { eventId, userId, status, ...overrides };
}

/** Does NOT maintain `confirmedCount`: a test seeding CONFIRMED rows sets the
 * counter itself, since the counter is what the code under test owns. */
export function mkRegistration(
  eventId: string,
  userId: string,
  status: RegistrationStatus,
  overrides: Partial<RegistrationSeed> = {},
): Promise<EventRegistration> {
  return testDb().eventRegistration.create({ data: aRegistration(eventId, userId, status, overrides) });
}
