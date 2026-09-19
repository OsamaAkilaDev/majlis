import { Injectable } from '@nestjs/common';
import type { EventStatus, SweepResult } from '@majlis/contracts';
import { AuditService } from '../audit/audit.service';
import { NotFoundError } from '../common/problem/domain-error';
import { TransactionHost } from '../prisma/transaction.host';
import { CHAIN, assertTransition, dueStatus, type DueStatusInput } from './event-status';

// Everything `dueStatus` reads, plus the columns `advanceAndRead`'s caller would
// otherwise read again. Scalars only: a relation here would be a second statement.
const LIFECYCLE_SELECT = {
  id: true,
  clubId: true,
  status: true,
  endsAt: true,
  registrationClosesAt: true,
  checkInOpensAt: true,
  checkInClosesAt: true,
} as const;

export type LifecycleRow = DueStatusInput & {
  id: string;
  clubId: string;
  endsAt: Date;
};

/** A sweep that found more than this has a bigger problem than a slow run. */
const SWEEP_LIMIT = 500;

function chainIndex(status: EventStatus): number {
  return (CHAIN as readonly EventStatus[]).indexOf(status);
}

// The lazy lifecycle of spec 7.3. Only publication and cancellation are
// operator-driven; every other transition is a function of the clock, and this
// is the only thing that performs one.
@Injectable()
export class EventLifecycleService {
  constructor(
    private readonly host: TransactionHost,
    private readonly audit: AuditService,
  ) {}

  /**
   * Drives one event to its due status, one chain step at a time, an audit row
   * per hop. Idempotent. Callers that may go on to REFUSE the action they were
   * asked for must call this BEFORE opening their own transaction: inside one,
   * host.run joins it and the refusal rolls the advance back with itself.
   */
  async advance(eventId: string): Promise<EventStatus> {
    return (await this.advanceAndRead(eventId)).status;
  }

  /**
   * `advance()`, plus the row it read to decide, saving the caller a second read
   * (the scan path, spec 7.5, is where that matters). Same warning as
   * `advance()`: call this BEFORE opening your own transaction, never inside one.
   */
  async advanceAndRead(eventId: string): Promise<LifecycleRow> {
    const now = new Date();
    const event = await this.host.tx.event.findUnique({
      where: { id: eventId },
      select: LIFECYCLE_SELECT,
    });
    if (!event) throw new NotFoundError('No such event.');

    // Checked before the transaction opens: every event read calls this and
    // almost none have a hop due, so a BEGIN and COMMIT each time bought nothing.
    if (dueStatus(event, now) === event.status) return event;

    return this.host.run(async () => {
      // Re-read inside the transaction, skipping the walk when a concurrent
      // advance committed between the check above and this BEGIN. One still open
      // is invisible under READ COMMITTED; each hop's conditional update catches it.
      const fresh = await this.host.tx.event.findUnique({
        where: { id: eventId },
        select: LIFECYCLE_SELECT,
      });
      if (!fresh) throw new NotFoundError('No such event.');
      return { ...fresh, status: await this.advanceRow(fresh, now) };
    });
  }

  private async advanceRow(event: LifecycleRow, now: Date): Promise<EventStatus> {
    const due = dueStatus(event, now);
    let current = event.status;

    // Forward only. An event whose check-in window moved into the future must
    // not be dragged back out of COMPLETED: attendance was taken against it.
    while (chainIndex(due) > chainIndex(current)) {
      const next = CHAIN[chainIndex(current) + 1]!;
      assertTransition(current, next);

      // Conditional on the status this walk believes the row is in. A plain
      // update lets a stale reader replay the whole walk after a concurrent
      // advance committed: the status goes backwards, with an audit row per hop.
      const { count } = await this.host.tx.event.updateMany({
        where: { id: event.id, status: current },
        data: { status: next },
      });
      if (count === 0) break;

      // Same transaction as the hop, so spec 7.6's "a NO_SHOW never receives a
      // certificate" has a status to assert against. CONFIRMED only: CANCELLED
      // withdrew, and WAITLISTED never held a seat, so marking them NO_SHOW
      // would inflate the roster's `expected` denominator.
      const noShow =
        next === 'COMPLETED'
          ? (
              await this.host.tx.eventRegistration.updateMany({
                where: { eventId: event.id, status: 'CONFIRMED' },
                data: { status: 'NO_SHOW' },
              })
            ).count
          : 0;

      await this.audit.record({
        action: 'event.status_advanced',
        entityType: 'Event',
        entityId: event.id,
        outcome: 'SUCCESS',
        before: { status: current },
        after: { status: next, ...(next === 'COMPLETED' ? { noShow } : {}) },
      });
      current = next;
    }

    return current;
  }

  /**
   * The backstop, not the mechanism: every read and action advances the event it
   * touches, so this only catches events nobody looked at. Each advances in its
   * own transaction, so one bad row cannot roll back the rest.
   */
  async sweep(now = new Date()): Promise<Omit<SweepResult, 'certificatesIssued'>> {
    const rows = await this.host.tx.event.findMany({
      where: {
        status: { in: ['PUBLISHED', 'REGISTRATION_CLOSED', 'ONGOING'] },
        // Any boundary already passed makes the row a candidate: the check-in
        // window may open before registration closes, so the registration
        // boundary alone is not enough.
        OR: [
          { registrationClosesAt: { lte: now } },
          { checkInOpensAt: { lte: now } },
          { checkInClosesAt: { lt: now } },
        ],
      },
      select: LIFECYCLE_SELECT,
      take: SWEEP_LIMIT,
    });

    let advanced = 0;
    for (const row of rows) {
      // A row whose due status is behind its current one (a boundary moved into
      // the future) is no candidate: advanceRow walks forward only, so calling
      // it opens a transaction that does nothing, every sweep.
      if (chainIndex(dueStatus(row, now)) <= chainIndex(row.status)) continue;
      // Count what actually moved, not what was called.
      if ((await this.advance(row.id)) !== row.status) advanced += 1;
    }

    return { scanned: rows.length, advanced };
  }
}
