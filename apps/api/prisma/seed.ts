import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';

/**
 * Development data. Idempotent by construction: every write is an upsert keyed
 * on a natural unique column, so re-running is a no-op rather than a
 * constraint violation. Prisma 7 no longer runs this automatically.
 */

// Development only. Real hashing arrives with auth in Stage 2.
const DEV_PASSWORD_HASH = '$argon2id$v=19$m=65536,t=3,p=4$DEVELOPMENT$SEED-ONLY-NOT-A-REAL-HASH';

const hours = (n: number) => new Date(Date.now() + n * 3_600_000);

export async function seed(prisma: PrismaClient): Promise<void> {
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
      update: { fullName: person.fullName, platformRole: person.platformRole },
      create: { ...person, passwordHash: DEV_PASSWORD_HASH },
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

  // Appointments have no natural unique key, so idempotency is a guarded
  // create rather than an upsert. The one-active-Lead partial index would
  // otherwise reject the second run.
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

    // Team members hold an ordinary membership too, kept as a separate record.
    const membership = await prisma.clubMembership.findFirst({
      where: { clubId: club.id, userId: users[email]!, status: 'ACTIVE' },
    });
    if (!membership) {
      await prisma.clubMembership.create({
        data: { clubId: club.id, userId: users[email]!, status: 'ACTIVE', decidedAt: new Date() },
      });
    }
  }

  await prisma.event.upsert({
    where: { clubId_slug: { clubId: club.id, slug: 'intro-to-ros' } },
    update: {},
    create: {
      clubId: club.id,
      title: 'Introduction to ROS 2',
      slug: 'intro-to-ros',
      summary: 'A hands-on first session with the Robot Operating System.',
      description: 'Bring a laptop. No prior robotics experience required.',
      eventType: 'WORKSHOP',
      audience: 'ALL_STUDENTS',
      venue: 'Engineering Building, Lab 2.14',
      startsAt: hours(48),
      endsAt: hours(51),
      registrationOpensAt: hours(-24),
      registrationClosesAt: hours(46),
      checkInOpensAt: hours(47),
      checkInClosesAt: hours(51.5),
      capacity: 30,
      waitlistEnabled: true,
      certificateEnabled: true,
      certificateTitle: 'Certificate of Attendance — Introduction to ROS 2',
      status: 'PUBLISHED',
      createdById: users['lead@uni.ac.ae']!,
    },
  });
}

/**
 * This script writes placeholder accounts carrying a fake password hash, plus
 * a PUBLISHED event. It must never reach a real database.
 *
 * The test harness refuses any connection string not naming `majlis_test`;
 * this is the reciprocal guard for the development path. A `.env` pointed at
 * a deployed database is an ordinary mistake, and without this the only
 * symptom would be placeholder credentials appearing in production.
 */
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

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
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
