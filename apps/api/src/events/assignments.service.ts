import { Injectable } from '@nestjs/common';
import type { AssignResponsibilityBody, Assignment, AssignmentList } from '@majlis/contracts';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- value import: Nest DI resolves this from design:paramtypes.
import { AuditService } from '../audit/audit.service';
import { assertAcceptsEdits } from '../clubs/club-status';
import { ConflictError, NotFoundError } from '../common/problem/domain-error';
import { violatedConstraintName } from '../common/prisma-constraint';
import { Prisma, type EventAssignment as AssignmentRow } from '../generated/prisma/client';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- value import: see above.
import { TransactionHost } from '../prisma/transaction.host';

const WITH_USER = { user: { select: { fullName: true, email: true } } } as const;
type AssignmentWithUser = AssignmentRow & { user: { fullName: string; email: string } };

function toAssignment(row: AssignmentWithUser): Assignment {
  return {
    id: row.id,
    eventId: row.eventId,
    userId: row.userId,
    userFullName: row.user.fullName,
    userEmail: row.user.email,
    responsibility: row.responsibility,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Per-event responsibilities: how a Lead grants scan rights for one event
 * without making someone a standing officer (spec 5.1).
 */
@Injectable()
export class AssignmentsService {
  constructor(
    private readonly host: TransactionHost,
    private readonly audit: AuditService,
  ) {}

  /** Not paginated: an event's assignment list is a handful of rows by design. */
  async list(eventId: string): Promise<AssignmentList> {
    await this.loadEvent(eventId);
    const rows = await this.host.tx.eventAssignment.findMany({
      where: { eventId },
      orderBy: { id: 'asc' },
      include: WITH_USER,
    });
    return { items: rows.map(toAssignment) };
  }

  async assign(
    actor: { id: string },
    eventId: string,
    body: AssignResponsibilityBody,
  ): Promise<Assignment> {
    return this.host.run(async () => {
      const event = await this.loadEvent(eventId);
      assertAcceptsEdits(event.club.status);

      const row = await this.host.tx.eventAssignment
        .create({
          data: {
            eventId,
            userId: body.userId,
            responsibility: body.responsibility,
            assignedById: actor.id,
          },
          include: WITH_USER,
        })
        .catch((e: unknown) => {
          if (
            e instanceof Prisma.PrismaClientKnownRequestError &&
            e.code === 'P2002' &&
            violatedConstraintName(e.meta).includes('event_assignment')
          ) {
            throw new ConflictError('That person already holds that responsibility on this event.');
          }
          throw e;
        });

      await this.audit.record({
        action: 'event.responsibility_assigned',
        entityType: 'EventAssignment',
        entityId: row.id,
        outcome: 'SUCCESS',
        actorUserId: actor.id,
        after: { eventId, userId: row.userId, responsibility: row.responsibility },
      });

      return toAssignment(row);
    });
  }

  /**
   * DELETE /events/:eventId/assignments/:assignmentId. The row is loaded by
   * `{ id, eventId }`, not by id alone: the permission was granted over the
   * event on the path, so an id from another event must be a 404 rather than
   * a deletion the guard never authorised.
   */
  async remove(actor: { id: string }, eventId: string, assignmentId: string): Promise<void> {
    return this.host.run(async () => {
      const existing = await this.host.tx.eventAssignment.findFirst({
        where: { id: assignmentId, eventId },
      });
      if (!existing) throw new NotFoundError('No such assignment.');

      await this.host.tx.eventAssignment.delete({ where: { id: existing.id } });
      await this.audit.record({
        action: 'event.responsibility_removed',
        entityType: 'EventAssignment',
        entityId: existing.id,
        outcome: 'SUCCESS',
        actorUserId: actor.id,
        before: {
          eventId,
          userId: existing.userId,
          responsibility: existing.responsibility,
        },
      });
    });
  }

  private async loadEvent(eventId: string) {
    const event = await this.host.tx.event.findUnique({
      where: { id: eventId },
      include: { club: { select: { status: true } } },
    });
    if (!event) throw new NotFoundError('No such event.');
    return event;
  }
}
