import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestPrisma, disconnectTestPrisma, truncateAll } from '../db';

const prisma = createTestPrisma();

afterAll(async () => { await disconnectTestPrisma(prisma); });
beforeEach(async () => { await truncateAll(prisma); });

function newUser(over: Partial<{ email: string; fullName: string }> = {}) {
  return {
    email: over.email ?? `student.${Math.random().toString(36).slice(2)}@uni.ac.ae`,
    passwordHash: 'argon2id$placeholder',
    fullName: over.fullName ?? 'Test Student',
  };
}

describe('User', () => {
  it('assigns a UUID v7 id, which is time-sortable', async () => {
    const first = await prisma.user.create({ data: newUser() });
    await new Promise((r) => setTimeout(r, 5));
    const second = await prisma.user.create({ data: newUser() });

    // Version nibble of a UUID v7 sits at index 14.
    expect(first.id[14]).toBe('7');
    expect(first.id < second.id).toBe(true);
  });

  it('defaults to an ACTIVE student', async () => {
    const user = await prisma.user.create({ data: newUser() });
    expect(user.status).toBe('ACTIVE');
    expect(user.platformRole).toBe('STUDENT');
  });

  it('rejects a duplicate email', async () => {
    await prisma.user.create({ data: newUser({ email: 'dupe@uni.ac.ae' }) });
    await expect(prisma.user.create({ data: newUser({ email: 'dupe@uni.ac.ae' }) }))
      .rejects.toMatchObject({ code: 'P2002' });
  });

  it('rejects an email that is not already lowercased', async () => {
    await expect(prisma.user.create({ data: newUser({ email: 'Mixed@Uni.ac.ae' }) }))
      .rejects.toThrow(/user_email_lowercase/);
  });

  it('stores createdAt as timestamptz', async () => {
    const rows = await prisma.$queryRaw<{ data_type: string }[]>`
      SELECT data_type FROM information_schema.columns
      WHERE table_name = 'user' AND column_name = 'created_at'`;
    expect(rows[0]!.data_type).toBe('timestamp with time zone');
  });
});

describe('RefreshToken', () => {
  it('cascades away when its user is deleted', async () => {
    const user = await prisma.user.create({ data: newUser() });
    await prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: 'hash-1',
        familyId: '00000000-0000-7000-8000-000000000001',
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });

    await prisma.user.delete({ where: { id: user.id } });
    expect(await prisma.refreshToken.count()).toBe(0);
  });

  it('rejects a duplicate token hash', async () => {
    const user = await prisma.user.create({ data: newUser() });
    const base = {
      userId: user.id,
      familyId: '00000000-0000-7000-8000-000000000002',
      expiresAt: new Date(Date.now() + 86_400_000),
    };
    await prisma.refreshToken.create({ data: { ...base, tokenHash: 'same' } });
    await expect(prisma.refreshToken.create({ data: { ...base, tokenHash: 'same' } }))
      .rejects.toMatchObject({ code: 'P2002' });
  });
});
