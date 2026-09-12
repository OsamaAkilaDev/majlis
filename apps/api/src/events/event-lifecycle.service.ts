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
      // Re-read inside the transaction, so a concurrent advance that landed
      // between the check above and this BEGIN is seen rather than replayed.
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
      await this.host.tx.event.update({ where: { id: event.id }, data: { status: next } });
      await this.audit.record({
        action: 'event.status_advanced',
        entityType: 'Event',
        entityId: event.id,
        outcome: 'SUCCESS',
        before: { status: current },
        after: { status: next },
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
  async sweep(now = new Date()): Promise<SweepResult> {
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
      if (dueStatus(row, now) === row.status) continue;
      await this.advance(row.id);
      advanced += 1;
    }

    return { scanned: rows.length, advanced };
  }
}
