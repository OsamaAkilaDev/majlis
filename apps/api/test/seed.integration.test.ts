import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { seed } from '../prisma/seed';
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
      passes: await prisma.qrPass.count(),
    };

    await seed(prisma);
    const after2 = {
      users: await prisma.user.count(),
      clubs: await prisma.club.count(),
      events: await prisma.event.count(),
      appointments: await prisma.clubTeamAppointment.count(),
      passes: await prisma.qrPass.count(),
    };

    expect(after2).toEqual(after1);
  });

  it('never violates the one-active-Lead index on a re-run', async () => {
    await seed(prisma);
    await expect(seed(prisma)).resolves.toBeUndefined();
  });
});
