import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestPrisma, disconnectTestPrisma, truncateAll } from '../db';

const prisma = createTestPrisma();

afterAll(async () => { await disconnectTestPrisma(prisma); });
beforeEach(async () => { await truncateAll(prisma); });

let seq = 0;
const uniq = () => `${Date.now()}-${seq++}-${Math.random().toString(36).slice(2)}`;

async function aUser() {
  return prisma.user.create({
    data: { email: `u.${uniq()}@uni.ac.ae`, passwordHash: 'x', fullName: 'User' },
  });
}

async function aClub() {
  const department = await prisma.department.create({
    data: { name: `Dept ${uniq()}`, code: `D${uniq()}` },
  });
  return prisma.club.create({
    data: {
      departmentId: department.id,
      name: `Club ${uniq()}`,
      slug: `club-${uniq()}`,
      description: 'A club.',
      category: 'Technology',
      academicYear: '2026/2027',
      logoUrl: 'https://example.test/logo.png',
    },
  });
}

describe('Club', () => {
  it('is ACTIVE on creation — there is no approval gate', async () => {
    const club = await aClub();
    expect(club.status).toBe('ACTIVE');
  });

  it('defaults membership policy to OPEN', async () => {
    expect((await aClub()).membershipPolicy).toBe('OPEN');
  });

  it('rejects a duplicate slug', async () => {
    const club = await aClub();
    const department = await prisma.department.create({
      data: { name: `Dept ${uniq()}`, code: `D${uniq()}` },
    });
    await expect(
      prisma.club.create({
        data: {
          departmentId: department.id,
          name: `Club ${uniq()}`,
          slug: club.slug,
          description: 'x',
          category: 'x',
          academicYear: '2026/2027',
          logoUrl: 'https://example.test/logo.png',
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });
});

describe('ClubTeamAppointment — exactly one active Lead per club', () => {
  async function appoint(clubId: string, userId: string, role: 'LEAD' | 'OPERATIONS', status: 'ACTIVE' | 'ENDED' | 'INVITED') {
    return prisma.clubTeamAppointment.create({
      data: { clubId, userId, role, status, invitedById: userId },
    });
  }

  it('rejects a second ACTIVE Lead in the same club', async () => {
    const club = await aClub();
    const [a, b] = [await aUser(), await aUser()];
    await appoint(club.id, a.id, 'LEAD', 'ACTIVE');
    await expect(appoint(club.id, b.id, 'LEAD', 'ACTIVE')).rejects.toMatchObject({ code: 'P2002' });
  });

  it('allows a new ACTIVE Lead once the previous appointment has ENDED', async () => {
    const club = await aClub();
    const [a, b] = [await aUser(), await aUser()];
    const first = await appoint(club.id, a.id, 'LEAD', 'ACTIVE');
    await prisma.clubTeamAppointment.update({
      where: { id: first.id },
      data: { status: 'ENDED', endedAt: new Date() },
    });
    await expect(appoint(club.id, b.id, 'LEAD', 'ACTIVE')).resolves.toBeDefined();
  });

  it('allows an INVITED Lead alongside an ACTIVE one, since an invitation grants nothing', async () => {
    const club = await aClub();
    const [a, b] = [await aUser(), await aUser()];
    await appoint(club.id, a.id, 'LEAD', 'ACTIVE');
    await expect(appoint(club.id, b.id, 'LEAD', 'INVITED')).resolves.toBeDefined();
  });

  it('allows several active Operations officers in one club', async () => {
    const club = await aClub();
    const [a, b] = [await aUser(), await aUser()];
    await appoint(club.id, a.id, 'OPERATIONS', 'ACTIVE');
    await expect(appoint(club.id, b.id, 'OPERATIONS', 'ACTIVE')).resolves.toBeDefined();
  });

  it('allows the same person to lead two different clubs', async () => {
    const [c1, c2] = [await aClub(), await aClub()];
    const user = await aUser();
    await appoint(c1.id, user.id, 'LEAD', 'ACTIVE');
    await expect(appoint(c2.id, user.id, 'LEAD', 'ACTIVE')).resolves.toBeDefined();
  });
});

describe('ClubMembership — one open membership per (user, club)', () => {
  async function join(clubId: string, userId: string, status: 'PENDING' | 'ACTIVE' | 'LEFT' | 'REMOVED') {
    return prisma.clubMembership.create({ data: { clubId, userId, status } });
  }

  it('rejects a duplicate ACTIVE membership', async () => {
    const club = await aClub();
    const user = await aUser();
    await join(club.id, user.id, 'ACTIVE');
    await expect(join(club.id, user.id, 'ACTIVE')).rejects.toMatchObject({ code: 'P2002' });
  });

  it('rejects a PENDING request when an ACTIVE membership already exists', async () => {
    const club = await aClub();
    const user = await aUser();
    await join(club.id, user.id, 'ACTIVE');
    await expect(join(club.id, user.id, 'PENDING')).rejects.toMatchObject({ code: 'P2002' });
  });

  it('rejects a duplicate PENDING request', async () => {
    const club = await aClub();
    const user = await aUser();
    await join(club.id, user.id, 'PENDING');
    await expect(join(club.id, user.id, 'PENDING')).rejects.toMatchObject({ code: 'P2002' });
  });

  it('scopes the rule per user — two students may both hold open memberships in one club', async () => {
    // Without this, a (club_id)-only index would pass every other test in
    // this block while capping each club at one member platform-wide.
    const club = await aClub();
    const [a, b] = [await aUser(), await aUser()];
    await join(club.id, a.id, 'ACTIVE');
    await expect(join(club.id, b.id, 'ACTIVE')).resolves.toBeDefined();
  });

  it('allows re-joining after LEFT, and keeps the historic row', async () => {
    const club = await aClub();
    const user = await aUser();
    await join(club.id, user.id, 'LEFT');
    await expect(join(club.id, user.id, 'ACTIVE')).resolves.toBeDefined();
    expect(await prisma.clubMembership.count()).toBe(2);
  });
});
