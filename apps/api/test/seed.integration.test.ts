import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { assertSafeToSeed, seed } from '../prisma/seed';
import { createTestPrisma, disconnectTestPrisma, truncateAll } from './db';

const prisma = createTestPrisma();

afterAll(async () => { await disconnectTestPrisma(prisma); });
beforeEach(async () => { await truncateAll(prisma); });

describe('seed', () => {
  it('creates the four demo personas', async () => {
    await seed(prisma);
    const emails = (await prisma.user.findMany({ select: { email: true }, orderBy: { email: 'asc' } }))
      .map((u) => u.email);
    expect(emails).toEqual(['admin@uni.ac.ae', 'lead@uni.ac.ae', 'ops@uni.ac.ae', 'student@uni.ac.ae']);
  });

  it('makes exactly one Admin', async () => {
    await seed(prisma);
    expect(await prisma.user.count({ where: { platformRole: 'ADMIN' } })).toBe(1);
  });

  it('creates an active club with an active Lead and an active Operations officer', async () => {
    await seed(prisma);
    const club = await prisma.club.findFirstOrThrow();
    expect(club.status).toBe('ACTIVE');
    expect(await prisma.clubTeamAppointment.count({ where: { clubId: club.id, role: 'LEAD', status: 'ACTIVE' } })).toBe(1);
    expect(await prisma.clubTeamAppointment.count({ where: { clubId: club.id, role: 'OPERATIONS', status: 'ACTIVE' } })).toBe(1);
  });

  it('appoints the right people to those roles, not merely the right number', async () => {
    // Counting by role alone passes even if the two people were swapped —
    // the right number of wrong rows.
    await seed(prisma);
    const club = await prisma.club.findFirstOrThrow();
    const lead = await prisma.user.findUniqueOrThrow({ where: { email: 'lead@uni.ac.ae' } });
    const ops = await prisma.user.findUniqueOrThrow({ where: { email: 'ops@uni.ac.ae' } });

    await expect(
      prisma.clubTeamAppointment.findFirstOrThrow({
        where: { clubId: club.id, userId: lead.id, role: 'LEAD', status: 'ACTIVE' },
      }),
    ).resolves.toBeDefined();

    await expect(
      prisma.clubTeamAppointment.findFirstOrThrow({
        where: { clubId: club.id, userId: ops.id, role: 'OPERATIONS', status: 'ACTIVE' },
      }),
    ).resolves.toBeDefined();
  });

  it('makes admin@uni.ac.ae specifically the Admin', async () => {
    await seed(prisma);
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: 'admin@uni.ac.ae' } });
    expect(admin.platformRole).toBe('ADMIN');
  });

  it('gives every user a QR pass', async () => {
    await seed(prisma);
    expect(await prisma.qrPass.count()).toBe(await prisma.user.count());
  });

  it('is idempotent — running it twice changes nothing', async () => {
    await seed(prisma);
    const after1 = {
      users: await prisma.user.count(),
      clubs: await prisma.club.count(),
      events: await prisma.event.count(),
      appointments: await prisma.clubTeamAppointment.count(),
      memberships: await prisma.clubMembership.count(),
      departments: await prisma.department.count(),
      passes: await prisma.qrPass.count(),
    };

    await seed(prisma);
    const after2 = {
      users: await prisma.user.count(),
      clubs: await prisma.club.count(),
      events: await prisma.event.count(),
      appointments: await prisma.clubTeamAppointment.count(),
      memberships: await prisma.clubMembership.count(),
      departments: await prisma.department.count(),
      passes: await prisma.qrPass.count(),
    };

    expect(after2).toEqual(after1);
  });

  it('never violates the one-active-Lead index on a re-run', async () => {
    await seed(prisma);
    await expect(seed(prisma)).resolves.toBeUndefined();
  });

  it('refuses to seed a non-local database without an explicit opt-in', () => {
    const remote = 'postgresql://u:p@db.example.supabase.co:5432/postgres';
    expect(() => assertSafeToSeed(remote, {})).toThrow(/non-local/i);
    expect(() => assertSafeToSeed(remote, { ALLOW_REMOTE_SEED: 'yes' })).not.toThrow();
  });

  it('refuses to seed when NODE_ENV is production, even locally', () => {
    const local = 'postgresql://majlis:majlis@localhost:5432/majlis_dev';
    expect(() => assertSafeToSeed(local, { NODE_ENV: 'production' })).toThrow(/production/i);
    expect(() => assertSafeToSeed(local, {})).not.toThrow();
  });
});
