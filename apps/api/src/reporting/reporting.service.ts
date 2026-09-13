import { Injectable } from '@nestjs/common';
import type { ClubReport, OverviewReport } from '@majlis/contracts';
import { NotFoundError } from '../common/problem/domain-error';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- value import: Nest DI resolves this from design:paramtypes.
import { TransactionHost } from '../prisma/transaction.host';
import { EXPORT_ROW_CAP } from './csv';

/**
 * The same set AttendanceService counts as `expected`: a waitlisted student
 * never held a place and was never expected in the room, so counting them in
 * the denominator would make a full event look badly attended.
 */
const EXPECTED = ['CONFIRMED', 'CHECKED_IN', 'ATTENDED', 'NO_SHOW'] as const;
const ATTENDED = ['CHECKED_IN', 'ATTENDED'] as const;

/** One more than the cap, so the cap is detectable without a second COUNT. */
const TAKE = EXPORT_ROW_CAP + 1;

function tally<T extends string>(rows: { status: T; _count: number }[]): Record<string, number> {
  return Object.fromEntries(rows.map((r) => [r.status, r._count]));
}

@Injectable()
export class ReportingService {
  constructor(private readonly host: TransactionHost) {}

  /** GET /reports/overview. Platform totals. */
  async overview(): Promise<OverviewReport> {
    const [clubs, events, users, activeMemberships, certificatesIssued] = await Promise.all([
      this.host.tx.club.groupBy({ by: ['status'], _count: true }),
      this.host.tx.event.groupBy({ by: ['status'], _count: true }),
      this.host.tx.user.count(),
      this.host.tx.clubMembership.count({ where: { status: 'ACTIVE' } }),
      this.host.tx.certificate.count({ where: { status: 'ACTIVE' } }),
    ]);

    return {
      clubsByStatus: tally(clubs),
      eventsByStatus: tally(events),
      users,
      activeMemberships,
      certificatesIssued,
    };
  }

  /** GET /clubs/:clubId/reports. */
  async forClub(clubId: string): Promise<ClubReport> {
    const club = await this.host.tx.club.findUnique({ where: { id: clubId }, select: { id: true } });
    if (!club) throw new NotFoundError('No such club.');

    const inClub = { event: { clubId } };
    const [events, registrations, expected, attended, certificatesIssued] = await Promise.all([
      this.host.tx.event.count({ where: { clubId } }),
      this.host.tx.eventRegistration.count({ where: { ...inClub, status: { not: 'CANCELLED' } } }),
      this.host.tx.eventRegistration.count({ where: { ...inClub, status: { in: [...EXPECTED] } } }),
      this.host.tx.eventRegistration.count({ where: { ...inClub, status: { in: [...ATTENDED] } } }),
      this.host.tx.certificate.count({ where: { ...inClub, status: 'ACTIVE' } }),
    ]);

    return {
      clubId,
      events,
      registrations,
      expected,
      attended,
      // Zero, not NaN: a club whose events nobody registered for still has a
      // report, and a NaN would fail the response schema.
      attendanceRate: expected === 0 ? 0 : attended / expected,
      certificatesIssued,
    };
  }

  async eventRows(): Promise<{ headers: string[]; rows: unknown[][] }> {
    const rows = await this.host.tx.event.findMany({
      orderBy: { id: 'asc' },
      take: TAKE,
      include: { club: { select: { name: true } } },
    });

    return {
      headers: [
        'id',
        'club',
        'title',
        'status',
        'startsAt',
        'endsAt',
        'timezone',
        'venue',
        'capacity',
        'confirmedCount',
      ],
      rows: rows.map((e) => [
        e.id,
        e.club.name,
        e.title,
        e.status,
        e.startsAt,
        e.endsAt,
        e.timezone,
        e.venue,
        e.capacity,
        e.confirmedCount,
      ]),
    };
  }

  async registrationRows(eventId: string): Promise<{ headers: string[]; rows: unknown[][] }> {
    const rows = await this.host.tx.eventRegistration.findMany({
      where: { eventId },
      orderBy: { id: 'asc' },
      take: TAKE,
      include: { user: { select: { fullName: true, email: true } } },
    });

    return {
      headers: ['id', 'fullName', 'email', 'status', 'waitlistPosition', 'registeredAt', 'source'],
      rows: rows.map((r) => [
        r.id,
        r.user.fullName,
        r.user.email,
        r.status,
        r.waitlistPosition,
        r.registeredAt,
        r.source,
      ]),
    };
  }

  async attendanceRows(eventId: string): Promise<{ headers: string[]; rows: unknown[][] }> {
    const rows = await this.host.tx.attendanceRecord.findMany({
      where: { eventId },
      orderBy: { id: 'asc' },
      take: TAKE,
      include: { user: { select: { fullName: true, email: true } } },
    });

    return {
      headers: ['id', 'fullName', 'email', 'checkedInAt', 'method', 'correctedAt'],
      rows: rows.map((a) => [
        a.id,
        a.user.fullName,
        a.user.email,
        a.checkedInAt,
        a.method,
        a.correctedAt,
      ]),
    };
  }

  async certificateRows(eventId: string): Promise<{ headers: string[]; rows: unknown[][] }> {
    const rows = await this.host.tx.certificate.findMany({
      where: { eventId },
      orderBy: { id: 'asc' },
      take: TAKE,
    });

    return {
      headers: ['serialNumber', 'holderName', 'eventTitle', 'status', 'issuedAt', 'revokedAt'],
      rows: rows.map((c) => [
        c.serialNumber,
        c.holderNameSnapshot,
        c.eventTitleSnapshot,
        c.status,
        c.issuedAt,
        c.revokedAt,
      ]),
    };
  }
}
