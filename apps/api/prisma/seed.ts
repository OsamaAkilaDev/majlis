import { hash } from '@node-rs/argon2';
import { ARGON2_OPTIONS } from '../src/auth/auth.service';
import { PrismaClient } from '../src/generated/prisma/client';
import { pgAdapter } from '../src/prisma/pg-adapter';

// Development data. Every write is an upsert keyed on a natural unique column,
// so re-running restores each row to its declared state, not just its count.
// Prisma 7 no longer runs this automatically.

// Shared by every seeded persona (see README.md). Hashed here with the same
// ARGON2_OPTIONS the login path verifies against, so it cannot drift from them.
const SEED_PASSWORD = 'Passw0rd!';

const hours = (n: number) => new Date(Date.now() + n * 3_600_000);

/** Restores a seeded registration to the status its scenario needs. No natural
 * unique key, so not an upsert; a "create only if absent" guard leaves a row an
 * earlier suite run moved to NO_SHOW exactly where it was, and the scan then
 * fails as though the scanner were broken. CANCELLED rows are left behind
 * rather than reused: the one-open-per-user index allows a fresh row beside
 * them, which is what cancelling and registering again looks like. */
async function seedRegistration(
  prisma: PrismaClient,
  eventId: string,
  userId: string,
  status: 'CONFIRMED' | 'CHECKED_IN',
) {
  const existing = await prisma.eventRegistration.findFirst({
    where: { eventId, userId, status: { not: 'CANCELLED' } },
  });
  if (!existing) return prisma.eventRegistration.create({ data: { eventId, userId, status } });
  if (existing.status === status) return existing;
  return prisma.eventRegistration.update({ where: { id: existing.id }, data: { status } });
}

export async function seed(prisma: PrismaClient): Promise<void> {
  const passwordHash = await hash(SEED_PASSWORD, ARGON2_OPTIONS);

  const people = [
    { email: 'admin@uni.ac.ae', fullName: 'Amina Al Marri', platformRole: 'ADMIN' as const },
    { email: 'lead@uni.ac.ae', fullName: 'Yousef Rahman', platformRole: 'STUDENT' as const },
    { email: 'ops@uni.ac.ae', fullName: 'Sara Khalid', platformRole: 'STUDENT' as const },
    { email: 'student@uni.ac.ae', fullName: 'Layla Hassan', platformRole: 'STUDENT' as const },
  ];

  const users: Record<string, string> = {};
  for (const person of people) {
    const user = await prisma.user.upsert({
      where: { email: person.email },
      update: { fullName: person.fullName, platformRole: person.platformRole, passwordHash },
      create: { ...person, passwordHash },
    });
    users[person.email] = user.id;

    await prisma.qrPass.upsert({
      where: { userId: user.id },
      update: {},
      create: { userId: user.id },
    });
  }

  const department = await prisma.department.upsert({
    where: { code: 'ENG' },
    update: { name: 'Engineering' },
    create: { code: 'ENG', name: 'Engineering', description: 'Engineering faculty.' },
  });

  const club = await prisma.club.upsert({
    where: { slug: 'robotics-club' },
    update: {},
    create: {
      departmentId: department.id,
      name: 'Robotics Club',
      slug: 'robotics-club',
      description: 'Building and competing with autonomous robots.',
      category: 'Technology',
      academicYear: '2026/2027',
      logoUrl: 'https://placehold.co/512x512/png?text=RC',
      membershipPolicy: 'APPROVAL_REQUIRED',
    },
  });

  // A club nobody can self-join, so the accessibility suite always has a
  // disabled join control to scan, whatever policy the first club carries.
  await prisma.club.upsert({
    where: { slug: 'chess-club' },
    update: { membershipPolicy: 'CLOSED' },
    create: {
      departmentId: department.id,
      name: 'Chess Club',
      slug: 'chess-club',
      description: 'Weekly rapid and blitz.',
      category: 'Games',
      academicYear: '2026/2027',
      logoUrl: 'https://placehold.co/512x512/png?text=CC',
      membershipPolicy: 'CLOSED',
    },
  });

  // No natural unique key, so idempotency is a guarded create, not an upsert:
  // the one-active-Lead partial index would reject the second run.
  for (const [email, role] of [
    ['lead@uni.ac.ae', 'LEAD'],
    ['ops@uni.ac.ae', 'OPERATIONS'],
  ] as const) {
    const existing = await prisma.clubTeamAppointment.findFirst({
      where: { clubId: club.id, userId: users[email]!, role, status: 'ACTIVE' },
    });
    if (!existing) {
      await prisma.clubTeamAppointment.create({
        data: {
          clubId: club.id,
          userId: users[email]!,
          role,
          status: 'ACTIVE',
          invitedById: users['admin@uni.ac.ae']!,
          acceptedAt: new Date(),
        },
      });
    }

    // Team members hold an ordinary membership too, as a separate record.
    const membership = await prisma.clubMembership.findFirst({
      where: { clubId: club.id, userId: users[email]!, status: 'ACTIVE' },
    });
    if (!membership) {
      await prisma.clubMembership.create({
        data: { clubId: club.id, userId: users[email]!, status: 'ACTIVE', decidedAt: new Date() },
      });
    }
  }

  // Used for both upsert branches: the concurrency tests turn on capacity being
  // what this says, and an empty `update` never restores it.
  const event = {
    title: 'Introduction to ROS 2',
    summary: 'A hands-on first session with the Robot Operating System.',
    description: 'Bring a laptop. No prior robotics experience required.',
    eventType: 'WORKSHOP',
    audience: 'ALL_STUDENTS',
    venue: 'Engineering Building, Lab 2.14',
    startsAt: hours(48),
    endsAt: hours(51),
    registrationOpensAt: hours(-24),
    registrationClosesAt: hours(46),
    capacity: 30,
    waitlistEnabled: true,
    certificateEnabled: true,
    certificateTitle: 'Certificate of Attendance: Introduction to ROS 2',
    certificateSignatory: 'Head of Engineering',
    status: 'PUBLISHED',
  } as const;

  await prisma.event.upsert({
    where: { clubId_slug: { clubId: club.id, slug: 'intro-to-ros' } },
    update: event,
    create: {
      ...event,
      clubId: club.id,
      slug: 'intro-to-ros',
      createdById: users['lead@uni.ac.ae']!,
    },
  });

  // An event nobody can register for, so the accessibility suite always has a
  // disabled register control to scan. Capacity one, taken, and no waitlist.
  const full = {
    ...event,
    title: 'Robotics Showcase',
    summary: 'The term-end demonstration of every team project.',
    description: 'Seats are limited to the demonstration floor.',
    eventType: 'SHOWCASE',
    venue: 'Engineering Building, Atrium',
    capacity: 1,
    confirmedCount: 1,
    waitlistEnabled: false,
    certificateEnabled: false,
    certificateTitle: null,
  };

  const showcase = await prisma.event.upsert({
    where: { clubId_slug: { clubId: club.id, slug: 'robotics-showcase' } },
    update: full,
    create: {
      ...full,
      clubId: club.id,
      slug: 'robotics-showcase',
      createdById: users['lead@uni.ac.ae']!,
    },
  });

  // The one seat, held.
  await seedRegistration(prisma, showcase.id, users['lead@uni.ac.ae']!, 'CONFIRMED');

  // Two clocks nothing in the product can produce, since it cannot move an
  // event's boundaries into the past: one event running now, and one
  // whose 48-hour correction window has closed. Without them the scanner can
  // only be shown refusing and no certificate exists to verify. Both seeded
  // PUBLISHED and left for the lazy lifecycle to advance, so the status on
  // screen is one the product computed.
  const ongoing = {
    ...event,
    title: 'Drone Build Night',
    summary: 'Assemble and fly a micro quadcopter.',
    description: 'Parts provided. Doors open at the start time.',
    eventType: 'WORKSHOP',
    venue: 'Engineering Building, Hangar',
    startsAt: hours(-1),
    endsAt: hours(2),
    registrationOpensAt: hours(-48),
    registrationClosesAt: hours(-2),
    confirmedCount: 1,
    certificateEnabled: false,
    certificateTitle: null,
  };

  const tonight = await prisma.event.upsert({
    where: { clubId_slug: { clubId: club.id, slug: 'drone-build-night' } },
    update: { ...ongoing, status: 'PUBLISHED' },
    create: {
      ...ongoing,
      clubId: club.id,
      slug: 'drone-build-night',
      createdById: users['lead@uni.ac.ae']!,
    },
  });

  // Back to CONFIRMED even if an earlier suite run checked it in or swept it to
  // NO_SHOW: this is the registration the scanner walk scans.
  await seedRegistration(prisma, tonight.id, users['student@uni.ac.ae']!, 'CONFIRMED');

  const finished = {
    ...event,
    title: 'Line Follower Sprint',
    summary: 'A one-evening race between self-built line followers.',
    description: 'Track time is allocated on arrival.',
    eventType: 'COMPETITION',
    venue: 'Engineering Building, Lab 1.02',
    startsAt: hours(-75),
    endsAt: hours(-72),
    registrationOpensAt: hours(-120),
    registrationClosesAt: hours(-76),
    confirmedCount: 1,
    certificateEnabled: true,
    certificateTitle: 'Certificate of Attendance: Line Follower Sprint',
    certificateSignatory: 'Head of Engineering',
  };

  const past = await prisma.event.upsert({
    where: { clubId_slug: { clubId: club.id, slug: 'line-follower-sprint' } },
    // No status here: the walk is forward-only, and putting a CERTIFIED event
    // back to PUBLISHED on reseed would strand the certificates it issued.
    update: finished,
    create: {
      ...finished,
      clubId: club.id,
      slug: 'line-follower-sprint',
      status: 'PUBLISHED',
      createdById: users['lead@uni.ac.ae']!,
    },
  });

  // CHECKED_IN, so the COMPLETED hop leaves it alone and it is certificate
  // eligible. The attendance record comes with it: checked in with no record is
  // a state the product cannot produce.
  const attended = await seedRegistration(prisma, past.id, users['student@uni.ac.ae']!, 'CHECKED_IN');
  await prisma.attendanceRecord.upsert({
    where: { registrationId: attended.id },
    update: {},
    create: {
      registrationId: attended.id,
      eventId: past.id,
      userId: users['student@uni.ac.ae']!,
      checkedInById: users['ops@uni.ac.ae']!,
      checkedInAt: hours(-74.5),
      method: 'QR_SCAN',
    },
  });
}

/** This script writes accounts sharing one publicly-known password, so it must
 * never reach a real database. The test harness refuses any connection string
 * not naming `majlis_test`; this is the reciprocal guard for the development
 * path, where a `.env` pointed at a deployed database is an ordinary mistake. */
export function assertSafeToSeed(url: string, env: NodeJS.ProcessEnv): void {
  if (env.NODE_ENV === 'production') {
    throw new Error('Refusing to seed: NODE_ENV is production.');
  }

  const { hostname } = new URL(url);
  const isLocal = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';

  if (!isLocal && env.ALLOW_REMOTE_SEED !== 'yes') {
    throw new Error(
      `Refusing to seed the non-local database at ${hostname}. ` +
        'Set ALLOW_REMOTE_SEED=yes if that is genuinely what you want.',
    );
  }
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set.');
  assertSafeToSeed(url, process.env);

  const prisma = new PrismaClient({ adapter: pgAdapter(url) });
  try {
    await seed(prisma);
    console.error('Seed complete.');
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  void main();
}
