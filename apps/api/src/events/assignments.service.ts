import { Injectable } from '@nestjs/common';
import type {
  AssignResponsibilityBody,
  Assignment,
  AssignmentList,
  CursorPageQuery,
  RemoveAssignmentBody,
} from '@majlis/contracts';
import { AuditService } from '../audit/audit.service';
import { clubOverrideReason } from '../auth/override';
import type { PlatformRole } from '../auth/permissions';
import { assertAcceptsEdits } from '../clubs/club-status';
import { cursorArgs, cursorPage } from '../common/cursor-page';
import { NotFoundError } from '../common/problem/domain-error';
import { conflictOn } from '../common/prisma-constraint';
import type { EventAssignment as AssignmentRow } from '../generated/prisma/client';
import { TransactionHost } from '../prisma/transaction.host';

const WITH_USER = { user: { select: { fullName: true, email: true } } } as const;

interface Actor {
  id: string;
  platformRole: PlatformRole;
}
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

// Per-event responsibilities: how a Lead grants scan rights for one event
// without making someone a standing officer (spec 5.1).
@Injectable()
export class AssignmentsService {
  constructor(
    private readonly host: TransactionHost,
    private readonly audit: AuditService,
  ) {}

  async list(eventId: string, query: CursorPageQuery): Promise<AssignmentList> {
    await this.loadEvent(eventId);
    const rows = await this.host.tx.eventAssignment.findMany({
      where: { eventId },
      ...cursorArgs(query),
      include: WITH_USER,
    });

    const { items, nextCursor } = cursorPage(rows, query.limit);

    return {
      items: items.map(toAssignment),
      nextCursor,
    };
  }

  async assign(
    actor: Actor,
    eventId: string,
    body: AssignResponsibilityBody,
  ): Promise<Assignment> {
    return this.host.run(async () => {
      const event = await this.loadEvent(eventId);
      assertAcceptsEdits(event.club.status);
      const reason = await clubOverrideReason(this.host, actor, event.clubId, body.overrideReason);

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
        .catch(
          conflictOn({
            event_assignment: 'That person already holds that responsibility on this event.',
          }),
        );

      await this.audit.record({
        action: 'event.responsibility_assigned',
        entityType: 'EventAssignment',
        entityId: row.id,
        outcome: 'SUCCESS',
        actorUserId: actor.id,
        ...(reason ? { reason } : {}),
        after: { eventId, userId: row.userId, responsibility: row.responsibility },
      });

      return toAssignment(row);
    });
  }

  // Loaded by `{ id, eventId }`, not by id alone: the permission was granted
  // over the event on the path, so an id from another event must be a 404.
  async remove(
    actor: Actor,
    eventId: string,
    assignmentId: string,
    body: RemoveAssignmentBody,
  ): Promise<void> {
    return this.host.run(async () => {
      const event = await this.loadEvent(eventId);
      const existing = await this.host.tx.eventAssignment.findFirst({
        where: { id: assignmentId, eventId },
      });
      if (!existing) throw new NotFoundError('No such assignment.');
      const reason = await clubOverrideReason(this.host, actor, event.clubId, body.overrideReason);

      await this.host.tx.eventAssignment.delete({ where: { id: existing.id } });
      await this.audit.record({
        action: 'event.responsibility_removed',
        entityType: 'EventAssignment',
        entityId: existing.id,
        outcome: 'SUCCESS',
        actorUserId: actor.id,
        ...(reason ? { reason } : {}),
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
