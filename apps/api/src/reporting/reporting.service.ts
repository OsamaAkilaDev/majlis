import { Injectable } from '@nestjs/common';
import type { ClubReport, OverviewReport } from '@majlis/contracts';
import { NotFoundError } from '../common/problem/domain-error';
import { TransactionHost } from '../prisma/transaction.host';

// The same set AttendanceService counts as `expected`: a waitlisted student
// never held a place, so counting them in the denominator would make a full
// event look badly attended.
const EXPECTED = ['CONFIRMED', 'CHECKED_IN', 'ATTENDED', 'NO_SHOW'] as const;
const ATTENDED = ['CHECKED_IN', 'ATTENDED'] as const;

function tally<T extends string>(rows: { status: T; _count: number }[]): Record<string, number> {
  return Object.fromEntries(rows.map((r) => [r.status, r._count]));
}

@Injectable()
export class ReportingService {
  constructor(private readonly host: TransactionHost) {}

  async overview(): Promise<OverviewReport> {
    const [clubs, events, users, activeMemberships, certificatesIssued] = await Promise.all([
      this.host.tx.club.groupBy({ by: ['status'], _count: true }),
      this.host.tx.event.groupBy({ by: ['status'], _count: true }),
      this.host.tx.user.count(),
      this.host.tx.clubMembership.count({ where: { status: 'ACTIVE' } }),
      // Every row, revoked included: a revoked certificate was still issued,
      // and filtering to ACTIVE makes the number fall when one is revoked.
      this.host.tx.certificate.count(),
    ]);

    return {
      clubsByStatus: tally(clubs),
      eventsByStatus: tally(events),
      users,
      activeMemberships,
      certificatesIssued,
    };
  }

  async forClub(clubId: string): Promise<ClubReport> {
    const club = await this.host.tx.club.findUnique({ where: { id: clubId }, select: { id: true } });
    if (!club) throw new NotFoundError('No such club.');

    const inClub = { event: { clubId } };
    const [events, registrations, expected, attended, certificatesIssued] = await Promise.all([
      this.host.tx.event.count({ where: { clubId } }),
      this.host.tx.eventRegistration.count({ where: { ...inClub, status: { not: 'CANCELLED' } } }),
      this.host.tx.eventRegistration.count({ where: { ...inClub, status: { in: [...EXPECTED] } } }),
      this.host.tx.eventRegistration.count({ where: { ...inClub, status: { in: [...ATTENDED] } } }),
      // Every row, as in the overview above.
      this.host.tx.certificate.count({ where: inClub }),
    ]);

    return {
      clubId,
      events,
      registrations,
      expected,
      attended,
      // Zero, not NaN: a club nobody registered for still has a report, and a
      // NaN would fail the response schema.
      attendanceRate: expected === 0 ? 0 : attended / expected,
      certificatesIssued,
    };
  }
}
