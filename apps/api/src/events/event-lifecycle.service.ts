import { Injectable } from '@nestjs/common';
import type { EventStatus, SweepResult } from '@majlis/contracts';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- value import: Nest DI resolves this from design:paramtypes.
import { AuditService } from '../audit/audit.service';
import { NotFoundError } from '../common/problem/domain-error';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- value import: see above.
import { TransactionHost } from '../prisma/transaction.host';
import { CHAIN, assertTransition, dueStatus, type DueStatusInput } from './event-status';

/** Everything `dueStatus` reads, plus the id to write back to. */
const LIFECYCLE_SELECT = {
  id: true,
  status: true,
  registrationClosesAt: true,
  checkInOpensAt: true,
  checkInClosesAt: true,
} as const;

type LifecycleRow = DueStatusInput & { id: string };

/** A sweep that found more than this has a bigger problem than a slow run. */
const SWEEP_LIMIT = 500;

function chainIndex(status: EventStatus): number {
  return (CHAIN as readonly EventStatus[]).indexOf(status);
}

/**
 * The lazy lifecycle of spec 7.3. Only publication and cancellation are
 * operator-driven; every other transition is a function of the clock, and
 * this is the only thing that performs one.
 */
@Injectable()
export class EventLifecycleService {
  constructor(
    private readonly host: TransactionHost,
    private readonly audit: AuditService,
  ) {}

  /**
   * Drives one event to its due status, one chain step at a time, writing an
   * audit row per hop. Idempotent: an event already at its due status does no
   * work and writes nothing.
   *
   * Callers that may go on to REFUSE the action they were asked for (a
   * registration outside its window, say) must call this BEFORE opening their
   * own transaction. Inside one, host.run joins the caller's transaction and
   * the refusal would roll the advance back along with itself.
   */
  async advance(eventId: string): Promise<EventStatus> {
    const now = new Date();
    const event = await this.host.tx.event.findUnique({
      where: { id: eventId },
      select: LIFECYCLE_SELECT,
    });
    if (!event) throw new NotFoundError('No such event.');

    // Every read of an event calls this and almost none of them have a hop
    // due, so the check happens before the transaction opens rather than
    // inside it: a BEGIN and a COMMIT per event read bought nothing.
    if (dueStatus(event, now) === event.status) return event.status;

    return this.host.run(async () => {
      // Re-read inside the transaction, which skips the walk entirely when a
      // concurrent advance COMMITTED between the check above and this BEGIN.
      // One that is still open is invisible here under READ COMMITTED; each
      // hop's conditional update is what catches that case.
      const fresh = await this.host.tx.event.findUnique({
        where: { id: eventId },
        select: LIFECYCLE_SELECT,
      });
      if (!fresh) throw new NotFoundError('No such event.');
      return this.advanceRow(fresh, now);
    });
  }

  private async advanceRow(event: LifecycleRow, now: Date): Promise<EventStatus> {
    const due = dueStatus(event, now);
    let current = event.status;

    // Walks forward only. An event whose check-in window was moved back into
    // the future must not be dragged back out of COMPLETED: attendance has
    // already been taken against it.
    while (chainIndex(due) > chainIndex(current)) {
      const next = CHAIN[chainIndex(current) + 1]!;
      assertTransition(current, next);

      // Conditional on the status this walk believes the row is in. A plain
      // update would let a transaction holding a stale read replay the whole
      // walk after a concurrent advance committed, writing the status
      // backwards and then forwards and an audit row per replayed hop.
      const { count } = await this.host.tx.event.updateMany({
        where: { id: event.id, status: current },
        data: { status: next },
      });
      if (count === 0) break;

      // Nobody who still held a place when the check-in window shut turned
      // up. Writing that down in the same transaction as the hop is what
      // makes the roster truthful after an event, and it is what gives "a
      // NO_SHOW never receives a certificate" (spec 7.6) something to
      // assert against rather than the mere absence of an attendance row.
      //
      // CONFIRMED only. CHECKED_IN and ATTENDED are untouched; so is
      // CANCELLED, which records someone who withdrew rather than someone
      // who failed to come. WAITLISTED stays WAITLISTED: that student never
      // held a seat, so they were never expected in the room, and turning
      // them into a NO_SHOW would inflate the roster's `expected`
      // denominator the moment the event completed.
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
   * POST /internal/lifecycle-sweep. The backstop, not the mechanism: every
   * read and action advances the event it touches, so this only catches
   * events nobody looked at.
   *
   * Each event advances in its own transaction rather than one transaction
   * for the whole sweep, so one unexpected row cannot roll back the rest.
   */
  async sweep(now = new Date()): Promise<Omit<SweepResult, 'certificatesIssued'>> {
    const rows = await this.host.tx.event.findMany({
      where: {
        status: { in: ['PUBLISHED', 'REGISTRATION_CLOSED', 'ONGOING'] },
        // Any boundary already passed makes the row a candidate. The check-in
        // window may open before registration closes, so this cannot be
        // narrowed to the registration boundary alone.
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
      // A row whose due status is BEHIND its current one (a boundary moved
      // into the future) is not a candidate at all: advanceRow walks forward
      // only, so calling it opens a transaction that does nothing, forever.
      if (chainIndex(dueStatus(row, now)) <= chainIndex(row.status)) continue;
      // Count what actually moved. Reporting the call rather than its result
      // makes the sweep's own number useless as a signal that anything
      // happened.
      if ((await this.advance(row.id)) !== row.status) advanced += 1;
    }

    return { scanned: rows.length, advanced };
  }
}
