import { randomUUID } from 'node:crypto';
import type {
  AppointmentStatus,
  Club,
  ClubRole,
  ClubTeamAppointment,
  Prisma,
  User,
} from '../src/generated/prisma/client';
import { createTestPrisma } from './db';

export type UserSeed = Prisma.UserCreateInput;
export type ClubSeed = Prisma.ClubUncheckedCreateInput;
export type DepartmentSeed = Prisma.DepartmentCreateInput;

/**
 * A value unique to this call. Integration tests share one database and
 * truncate between tests, but a collision inside a single test is still
 * possible with a fixed string — and a unique-constraint failure in setup
 * reads like a bug in the code under test.
 */
export function uniq(prefix: string): string {
  return `${prefix}-${randomUUID().slice(0, 8)}`;
}

/**
 * A plain seed object — does not touch the database. Email is lowercased
 * deliberately: the user table carries CHECK (email = lower(email)), so a
 * factory producing mixed case would fail on insert and every test would
 * start with a constraint error instead of the one it meant to check.
 */
export function aUser(overrides: Partial<UserSeed> = {}): UserSeed {
  const handle = uniq('user');
  return {
    email: `${handle}@uni.ac.ae`.toLowerCase(),
    passwordHash: 'not-a-real-hash-tests-that-log-in-must-set-this',
    fullName: 'Test Person',
    ...overrides,
  };
}

/** A plain seed object — does not touch the database. */
export function aDepartment(overrides: Partial<DepartmentSeed> = {}): DepartmentSeed {
  const handle = uniq('dept');
  return {
    name: `Department ${handle}`,
    code: handle.toUpperCase(),
    ...overrides,
  };
}

/** A plain seed object — does not touch the database. */
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

// vitest.integration.config.ts runs with pool: 'forks' and isolate left at
// its default (true), so each test file gets its own worker and its own
// module instance of this file — one lazily-created client per test file,
// not one shared across the whole run. It is left to be reclaimed when that
// file's forked worker exits rather than explicitly disconnected, which is
// safe at this scale (one extra connection per file, for the suite's
// lifetime only).
let db: ReturnType<typeof createTestPrisma> | undefined;
function testDb() {
  db ??= createTestPrisma();
  return db;
}

/** Inserts and returns a User row. */
export function mkUser(overrides: Partial<UserSeed> = {}): Promise<User> {
  return testDb().user.create({ data: aUser(overrides) });
}

/**
 * Inserts and returns a Club row, creating its Department too — so a test
 * needing a club never has to reach for a shared one just to skip that
 * step. Pass `departmentId` in overrides to place it in an existing
 * department instead.
 */
export async function mkClub(overrides: Partial<ClubSeed> = {}): Promise<Club> {
  const departmentId =
    overrides.departmentId ?? (await testDb().department.create({ data: aDepartment() })).id;
  return testDb().club.create({ data: aClub(departmentId, overrides) });
}

/**
 * Stage 4's naming convention for the same fixture `mkClub` already
 * provides, kept as one function rather than two implementations, so the
 * two naming styles cannot drift apart.
 */
export const makeClub = mkClub;

export interface AppointmentSeed {
  userId: string;
  clubId: string;
  role: ClubRole;
  status: AppointmentStatus;
}

/**
 * Inserts and returns a ClubTeamAppointment row. `status` is required, with
 * no default: the schema defaults a new appointment to INVITED, which
 * confers no permission at all, and a factory that silently defaulted to
 * ACTIVE instead would let a permission test that forgets to pass `status`
 * pass against a broken guard without ever noticing. Every caller states
 * outright which state it is testing. `invitedById` has no foreign key (see
 * the schema), so self-inviting is a harmless simplification here.
 */
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
