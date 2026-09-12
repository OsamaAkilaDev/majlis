import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestPrisma, disconnectTestPrisma, truncateAll } from '../db';
import { mkClub, mkUser, uniq } from '../factories';

const prisma = createTestPrisma();

afterAll(async () => { await disconnectTestPrisma(prisma); });
beforeEach(async () => { await truncateAll(prisma); });

const at = (hoursFromNow: number) => new Date(Date.now() + hoursFromNow * 3_600_000);

async function anEvent(over: Record<string, unknown> = {}) {
  const club = (over.clubId as string | undefined) ? null : await mkClub();
  const creator = await mkUser();
  return prisma.event.create({
    data: {
      clubId: (over.clubId as string) ?? club!.id,
      title: `Event ${uniq('event')}`,
      slug: (over.slug as string) ?? uniq('event'),
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
      createdById: creator.id,
      ...over,
    },
  });
}

describe('Event', () => {
  it('is DRAFT on creation with a zero confirmed count', async () => {
    const event = await anEvent();
    expect(event.status).toBe('DRAFT');
    expect(event.confirmedCount).toBe(0);
    expect(event.attendancePolicy).toBe('CHECK_IN_ONLY');
  });

  it('defaults the timezone to Asia/Dubai', async () => {
    expect((await anEvent()).timezone).toBe('Asia/Dubai');
  });

  it('rejects a confirmed count above capacity', async () => {
    const event = await anEvent({ capacity: 2 });
    await expect(
      prisma.event.update({ where: { id: event.id }, data: { confirmedCount: 3 } }),
    ).rejects.toThrow(/event_capacity_bounds/);
  });

  it('rejects an event created with zero capacity', async () => {
    // capacity > 0 is the third conjunct of event_capacity_bounds and is
    // otherwise untested — both other capacity tests only vary the counter.
    await expect(anEvent({ capacity: 0 })).rejects.toThrow(/event_capacity_bounds/);
  });

  it('allows registration to close exactly when the event ends', async () => {
    // The predicate is registration_closes_at <= ends_at. This boundary case
    // is what distinguishes it from a stricter <. Hoisted to one constant:
    // at() reads Date.now() fresh each call, so two separate calls can
    // straddle a millisecond and pass even under a stricter <, making the
    // test intermittently vacuous.
    const boundary = at(26);
    await expect(anEvent({ registrationClosesAt: boundary, endsAt: boundary })).resolves.toBeDefined();
  });

  it('rejects a negative confirmed count', async () => {
    const event = await anEvent();
    await expect(
      prisma.event.update({ where: { id: event.id }, data: { confirmedCount: -1 } }),
    ).rejects.toThrow(/event_capacity_bounds/);
  });

  it('rejects an event that ends before it starts', async () => {
    await expect(anEvent({ startsAt: at(30), endsAt: at(29) })).rejects.toThrow(/event_time_window/);
  });

  it('rejects a registration window that closes before it opens', async () => {
    await expect(anEvent({ registrationOpensAt: at(20), registrationClosesAt: at(19) }))
      .rejects.toThrow(/event_registration_window/);
  });

  it('rejects registration closing after the event ends', async () => {
    await expect(anEvent({ registrationClosesAt: at(40) })).rejects.toThrow(/event_registration_window/);
  });

  it('rejects a check-in window that closes before it opens', async () => {
    await expect(anEvent({ checkInOpensAt: at(26), checkInClosesAt: at(25) }))
      .rejects.toThrow(/event_check_in_window/);
  });

  it('scopes slug uniqueness to the club, so two clubs may both run "orientation"', async () => {
    const [c1, c2] = [await mkClub(), await mkClub()];
    await anEvent({ clubId: c1.id, slug: 'orientation' });
    await expect(anEvent({ clubId: c2.id, slug: 'orientation' })).resolves.toBeDefined();
  });

  it('rejects a duplicate slug within one club', async () => {
    const club = await mkClub();
    await anEvent({ clubId: club.id, slug: 'orientation' });
    await expect(anEvent({ clubId: club.id, slug: 'orientation' }))
      .rejects.toMatchObject({ code: 'P2002' });
  });
});

describe('EventRegistration — one open registration per (user, event)', () => {
  async function register(eventId: string, userId: string, status: 'CONFIRMED' | 'WAITLISTED' | 'CANCELLED' | 'REMOVED' | 'NO_SHOW') {
    return prisma.eventRegistration.create({ data: { eventId, userId, status } });
  }

  it('scopes the rule per user and per event', async () => {
    // Without this, an index on (event_id) alone would cap each event at one
    // registrant, and one on (user_id) alone would let a student register
    // only once ever — both would pass every other test in this block.
    const event = await anEvent();
    const [a, b] = [await mkUser(), await mkUser()];
    await register(event.id, a.id, 'CONFIRMED');

    // a different student may register for the same event
    await expect(register(event.id, b.id, 'CONFIRMED')).resolves.toBeDefined();

    // and the same student may register for a different event
    const other = await anEvent();
    await expect(register(other.id, a.id, 'CONFIRMED')).resolves.toBeDefined();
  });

  it('rejects a second CONFIRMED registration', async () => {
    const event = await anEvent();
    const user = await mkUser();
    await register(event.id, user.id, 'CONFIRMED');
    await expect(register(event.id, user.id, 'CONFIRMED')).rejects.toMatchObject({ code: 'P2002' });
  });

  it('rejects a WAITLISTED row when the student is already CONFIRMED', async () => {
    const event = await anEvent();
    const user = await mkUser();
    await register(event.id, user.id, 'CONFIRMED');
    await expect(register(event.id, user.id, 'WAITLISTED')).rejects.toMatchObject({ code: 'P2002' });
  });

  it('allows re-registration after cancelling, preserving the cancelled row', async () => {
    const event = await anEvent();
    const user = await mkUser();
    await register(event.id, user.id, 'CANCELLED');
    await expect(register(event.id, user.id, 'CONFIRMED')).resolves.toBeDefined();
    expect(await prisma.eventRegistration.count()).toBe(2);
  });

  it('blocks a REMOVED student from re-registering themselves', async () => {
    const event = await anEvent();
    const user = await mkUser();
    await register(event.id, user.id, 'REMOVED');
    await expect(register(event.id, user.id, 'CONFIRMED')).rejects.toMatchObject({ code: 'P2002' });
  });

  it('blocks re-registration after a NO_SHOW', async () => {
    const event = await anEvent();
    const user = await mkUser();
    await register(event.id, user.id, 'NO_SHOW');
    await expect(register(event.id, user.id, 'CONFIRMED')).rejects.toMatchObject({ code: 'P2002' });
  });
});

describe('EventAssignment', () => {
  it('lets a Lead grant scan rights for one event without a standing appointment', async () => {
    const event = await anEvent();
    const [member, lead] = [await mkUser(), await mkUser()];
    const assignment = await prisma.eventAssignment.create({
      data: { eventId: event.id, userId: member.id, responsibility: 'OPERATIONS', assignedById: lead.id },
    });
    expect(assignment.responsibility).toBe('OPERATIONS');
  });

  it('rejects the same person being assigned the same responsibility twice', async () => {
    const event = await anEvent();
    const [member, lead] = [await mkUser(), await mkUser()];
    const data = { eventId: event.id, userId: member.id, responsibility: 'OPERATIONS' as const, assignedById: lead.id };
    await prisma.eventAssignment.create({ data });
    await expect(prisma.eventAssignment.create({ data })).rejects.toMatchObject({ code: 'P2002' });
  });

  it('scopes the rule per (event, responsibility) — one person can hold two responsibilities on one event, and be assigned across two events', async () => {
    // Both tests above pass identically against a (user_id)-only unique:
    // the first test never varies the user or the event, and the second
    // never varies the responsibility. Only a matrix of user x event x
    // responsibility tells the two-column index apart from a one-column one.
    const event = await anEvent();
    const [member, lead] = [await mkUser(), await mkUser()];
    await prisma.eventAssignment.create({
      data: { eventId: event.id, userId: member.id, responsibility: 'OPERATIONS', assignedById: lead.id },
    });
    await expect(
      prisma.eventAssignment.create({
        data: { eventId: event.id, userId: member.id, responsibility: 'MARKETING', assignedById: lead.id },
      }),
    ).resolves.toBeDefined();

    const otherEvent = await anEvent();
    await expect(
      prisma.eventAssignment.create({
        data: { eventId: otherEvent.id, userId: member.id, responsibility: 'OPERATIONS', assignedById: lead.id },
      }),
    ).resolves.toBeDefined();
  });
});

describe('cursor-pagination indexes', () => {
  // Every list endpoint pages with `ORDER BY id`, which a (scope, status)
  // index cannot serve: Postgres walks the primary key instead and filters
  // out every other scope's rows. Measured on a 92k-row event_registration
  // table, one event's first roster page went from 16.3ms scanning 91,528
  // rows to 0.12ms scanning 21. These two indexes look redundant next to the
  // (scope, status) ones above them and are not. Do not drop them.
  it.each([
    ['event_registration', 'event_registration_event_id_id_idx', ['event_id', 'id']],
    ['club_membership', 'club_membership_club_id_id_idx', ['club_id', 'id']],
  ])('%s pages by id through %s', async (table, index, columns) => {
    const rows = await prisma.$queryRaw<{ column_name: string }[]>`
      SELECT a.attname AS column_name
      FROM pg_index i
      JOIN pg_class c ON c.oid = i.indexrelid
      JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey)
      WHERE c.relname = ${index}
      ORDER BY array_position(i.indkey::int[], a.attnum)`;

    expect(rows.map((r) => r.column_name), `${table} is missing ${index}`).toEqual(columns);
  });
});
