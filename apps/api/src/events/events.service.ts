import { Injectable } from '@nestjs/common';
import type {
  CancelEventBody,
  CreateEventBody,
  EventDetail,
  EventListQuery,
  EventPage,
  EventSummary,
  NewEventUpload,
  PatchEventBody,
  PublishEventBody,
  SignedUpload,
} from '@majlis/contracts';
import { v7 as uuidv7 } from 'uuid';
import { AuditService } from '../audit/audit.service';
import { EVENT_FIELDS, assertFieldsAllowed, overrideReasonFor } from '../auth/field-permissions';
import { clubOverrideReason } from '../auth/override';
import type { PlatformRole } from '../auth/permissions';
import { resolveClubFacts, resolveEventFacts } from '../auth/permissions.guard';
import { assertAcceptsNewActivity } from '../clubs/club-status';
import { loadClub } from '../clubs/load-club';
import { ClubsService } from '../clubs/clubs.service';
import { CertificatesService } from '../certificates/certificates.service';
import { deriveSlug, uniqueSlug } from '../clubs/slug';
import { cursorArgs, cursorPage } from '../common/cursor-page';
import { NotFoundError, UnprocessableError } from '../common/problem/domain-error';
import { conflictOn } from '../common/prisma-constraint';
import type { Prisma, Event as EventRow } from '../generated/prisma/client';
import { TransactionHost } from '../prisma/transaction.host';
import { EventLifecycleService } from './event-lifecycle.service';
import { NotificationService } from '../notifications/notification.service';
import { assertEventAcceptsEdits, assertTransition, dueStatus } from './event-status';
import { promoteFromWaitlist } from './waitlist';

const WITH_CLUB = { club: { select: { name: true, logoUrl: true, status: true } } } as const;
type EventWithClub = EventRow & { club: { name: string; logoUrl: string; status: 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED' } };

// Exactly the columns `toSummary` reads. A list page is the hottest read here
// and the full row carries `description`, the longest column on the table.
const SUMMARY_SELECT = {
  id: true,
  clubId: true,
  title: true,
  slug: true,
  summary: true,
  eventType: true,
  audience: true,
  venue: true,
  onlineUrl: true,
  bannerUrl: true,
  timezone: true,
  startsAt: true,
  endsAt: true,
  registrationOpensAt: true,
  registrationClosesAt: true,
  capacity: true,
  confirmedCount: true,
  waitlistEnabled: true,
  requiresClubMembership: true,
  status: true,
  club: { select: { name: true, logoUrl: true } },
} as const;

type EventSummaryRow = Prisma.EventGetPayload<{ select: typeof SUMMARY_SELECT }>;

interface Actor {
  id: string;
  platformRole: PlatformRole;
}

// Derived from EVENT_FIELDS, not listed again: a second hand-kept list drifts
// into a field that passes the permission gate and then writes nothing.
// `posterUploaded` is excluded because it is not a column.
const PATCHABLE = Object.keys(EVENT_FIELDS).filter((k) => k !== 'posterUploaded');

// Spec 7.7 names "material event change" without defining it: these are the
// fields deciding whether or where a student can turn up. A retitle notifies
// nobody.
const MATERIAL_FIELDS = ['startsAt', 'endsAt', 'venue', 'onlineUrl', 'timezone'] as const;

// A key present in the body but equal to what is stored is not a change:
// re-saving a form must not tell every attendee the event moved.
function materialChanges(before: EventRow, data: Record<string, unknown>): string[] {
  return MATERIAL_FIELDS.filter((key) => {
    const next = data[key];
    if (next === undefined) return false;
    const prev = before[key];
    if (prev instanceof Date) return new Date(next as string).getTime() !== prev.getTime();
    return next !== prev;
  });
}

interface Windows {
  startsAt: Date;
  endsAt: Date;
  registrationOpensAt: Date;
  registrationClosesAt: Date;
}

/**
 * The same three rules as the CHECK constraints in the events migration, applied
 * to the merged row so a patch carrying one half of a pair is checked against
 * the stored other half. The database stays the guarantee; this only turns a
 * violation into a message naming what was wrong.
 */
function assertWindows(w: Windows): void {
  if (w.startsAt >= w.endsAt) throw new UnprocessableError('An event must end after it starts.');
  if (w.registrationOpensAt >= w.registrationClosesAt) {
    throw new UnprocessableError('Registration must close after it opens.');
  }
  if (w.registrationClosesAt > w.endsAt) {
    throw new UnprocessableError('Registration cannot close after the event ends.');
  }
}

// `status` is rendered as `dueStatus`, not as stored: a list read must not
// write, and a row nobody has opened since its window closed is still stored
// PUBLISHED, so the badge would disagree with what the API accepts.
function toSummary(row: EventSummaryRow, now = new Date()): EventSummary {
  return {
    id: row.id,
    clubId: row.clubId,
    clubName: row.club.name,
    clubLogoUrl: row.club.logoUrl,
    title: row.title,
    slug: row.slug,
    summary: row.summary,
    eventType: row.eventType,
    audience: row.audience,
    venue: row.venue,
    onlineUrl: row.onlineUrl,
    bannerUrl: row.bannerUrl,
    timezone: row.timezone,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    registrationOpensAt: row.registrationOpensAt.toISOString(),
    registrationClosesAt: row.registrationClosesAt.toISOString(),
    capacity: row.capacity,
    confirmedCount: row.confirmedCount,
    waitlistEnabled: row.waitlistEnabled,
    requiresClubMembership: row.requiresClubMembership,
    status: dueStatus(row, now),
  };
}

export {
  toSummary as toEventSummary,
  WITH_CLUB as EVENT_WITH_CLUB,
  SUMMARY_SELECT as EVENT_SUMMARY_SELECT,
  type EventWithClub,
};

// `event_club_id_slug_key` is the only unique index on `event`, so the generic
// conflict text would never name what collided.
const mapWriteError = conflictOn({ slug: 'That club already has an event with that slug.' });

@Injectable()
export class EventsService {
  constructor(
    private readonly host: TransactionHost,
    private readonly audit: AuditService,
    private readonly lifecycle: EventLifecycleService,
    private readonly clubs: ClubsService,
    private readonly certificates: CertificatesService,
    private readonly notifications: NotificationService,
  ) {}

  // Mints the id the event will be created with, so the poster's object path
  // exists before the event does.
  async mintPosterUpload(): Promise<NewEventUpload> {
    const eventId = uuidv7();
    return { eventId, ...(await this.clubs.mintEditUpload(eventId, 'event-poster')) };
  }

  /**
   * Gated on the same field permission as `posterUploaded`, not the route's
   * `event:edit` alone, which admits all five club roles: otherwise an officer
   * who may not set the poster could mint a URL and overwrite it. It takes
   * `update`'s status gate too, since overwriting the live object is an edit.
   * The audit row is the only record of the replacement, the bytes never passing
   * through the API, and is written in the same transaction.
   */
  async mintEditUpload(actor: Actor, eventId: string): Promise<SignedUpload> {
    return this.host.run(async () => {
      const event = await this.loadEvent(eventId);
      assertEventAcceptsEdits(event);

      const { clubRoles } = await resolveClubFacts(this.host, actor.id, event.clubId);
      assertFieldsAllowed({ posterUploaded: true }, EVENT_FIELDS, {
        platformRole: actor.platformRole,
        clubRoles,
      });

      const upload = await this.clubs.mintEditUpload(eventId, 'event-poster');

      await this.audit.record({
        action: 'event.upload_url_minted',
        entityType: 'Event',
        entityId: eventId,
        outcome: 'SUCCESS',
        actorUserId: actor.id,
        after: { kind: 'event-poster', path: upload.path },
      });

      return upload;
    });
  }

  async create(actor: Actor, clubId: string, body: CreateEventBody): Promise<EventDetail> {
    return this.host.run(async () => {
      await loadClub(this.host, clubId, assertAcceptsNewActivity);

      const reason = await clubOverrideReason(this.host, actor, clubId, body.overrideReason);

      const windows: Windows = {
        startsAt: new Date(body.startsAt),
        endsAt: new Date(body.endsAt),
        registrationOpensAt: new Date(body.registrationOpensAt),
        registrationClosesAt: new Date(body.registrationClosesAt),
      };
      assertWindows(windows);

      const bannerUrl = body.posterUploaded
        ? await this.clubs.verifyUpload('event-poster', body.eventId)
        : null;

      // Unique per club, not globally (spec 5.1): the count must be scoped, or
      // two clubs could never both run an "Orientation".
      const slug = await uniqueSlug(deriveSlug(body.title), (s) =>
        this.host.tx.event.count({ where: { clubId, slug: s } }).then((n) => n > 0),
      );

      const row = await this.host.tx.event
        .create({
          data: {
            id: body.eventId,
            clubId,
            title: body.title,
            slug,
            summary: body.summary,
            description: body.description,
            eventType: body.eventType,
            audience: body.audience,
            venue: body.venue ?? null,
            onlineUrl: body.onlineUrl ?? null,
            bannerUrl,
            timezone: body.timezone,
            ...windows,
            capacity: body.capacity,
            waitlistEnabled: body.waitlistEnabled,
            requiresClubMembership: body.requiresClubMembership,
            certificateEnabled: body.certificateEnabled,
            certificateTitle: body.certificateTitle ?? null,
            certificateSignatory: body.certificateSignatory ?? null,
            attendancePolicy: body.attendancePolicy,
            createdById: actor.id,
          },
          include: WITH_CLUB,
        })
        .catch(mapWriteError);

      await this.audit.record({
        action: 'event.created',
        entityType: 'Event',
        entityId: row.id,
        outcome: 'SUCCESS',
        actorUserId: actor.id,
        ...(reason ? { reason } : {}),
        after: { clubId, title: row.title, slug: row.slug, capacity: row.capacity },
      });

      return this.toDetail(actor, row);
    });
  }

  /**
   * Renders each row's due status rather than advancing it: a page would cost
   * one transaction per row on a read. `?status=` therefore filters on the
   * stored value, so an unread row matches its old status (deviation, spec 13).
   */
  async list(actor: Actor, query: EventListQuery): Promise<EventPage> {
    const filters: Prisma.EventWhereInput = {
      ...(query.clubId ? { clubId: query.clubId } : {}),
      ...(query.status ? { status: query.status } : {}),
      // ponytail: `q` and `upcoming` both have an index behind them
      // (event_title_trgm_idx, event_ends_at_id_idx) and both are only
      // PARTLY used, for the same reason: this list orders by `id`, and
      // neither index delivers that order, so the planner keeps choosing a
      // primary-key walk whenever it estimates enough matches to hit the
      // page size quickly. Measured on 22,000 events:
      //
      //   q, zero or rare match  8.5 ms / 1,016 buffers -> 0.02 ms / 11
      //   q, common term         9.1 ms / 1,182 buffers -> 8.4 ms / 1,182
      //   upcoming=true          3.4 ms / 1,295 buffers -> 2.8 ms / 1,295
      //
      // The rest is behind the ordering, not the indexes: ordering by
      // `(ends_at, id)` takes upcoming=true to 0.02 ms / 5 buffers, and a
      // trigram-similarity order does the same for a common term. Both mean
      // this endpoint paginates on a different key, which changes the cursor
      // contract every caller holds. Left for a stage that can carry it.
      ...(query.q ? { title: { contains: query.q, mode: 'insensitive' as const } } : {}),
      ...(query.upcoming ? { endsAt: { gte: new Date() } } : {}),
    };
    const visible = await this.visibilityFilter(actor);

    const rows = await this.host.tx.event.findMany({
      where: visible ? { AND: [filters, visible] } : filters,
      ...cursorArgs(query, query.direction),
      select: SUMMARY_SELECT,
    });

    const { items, nextCursor } = cursorPage(rows, query.limit);
    const now = new Date();

    return {
      items: items.map((row) => toSummary(row, now)),
      nextCursor,
    };
  }

  // Advances first, so nobody reads a stale status.
  async detail(actor: Actor, eventId: string): Promise<EventDetail> {
    const status = await this.lifecycle.advance(eventId);
    // Spec 7.6's opportunistic issuance, gated on the status the advance left
    // behind so an ordinary read costs nothing extra.
    if (status === 'COMPLETED') await this.certificates.issueForEvent(eventId);
    return this.readDetail(actor, eventId);
  }

  private async readDetail(actor: Actor, eventId: string): Promise<EventDetail> {
    const row = await this.loadEvent(eventId);

    // toDetail already resolves the roles and assignments visibilityFilter would
    // query again, so the draft gate below reads them off the built detail.
    const detail = await this.toDetail(actor, row);

    // A draft the viewer is not on the team of is a 404, not a 403: telling them
    // it exists is itself the leak.
    if (
      row.status === 'DRAFT' &&
      actor.platformRole !== 'ADMIN' &&
      detail.viewerClubRoles.length === 0 &&
      detail.viewerResponsibilities.length === 0
    ) {
      throw new NotFoundError('No such event.');
    }
    return detail;
  }

  private async loadEvent(eventId: string): Promise<EventWithClub> {
    const row = await this.host.tx.event.findUnique({ where: { id: eventId }, include: WITH_CLUB });
    if (!row) throw new NotFoundError('No such event.');
    return row;
  }

  // Restricts a read to what `actor` may see, or null for Admin. A DRAFT is
  // visible to the club's standing officers and this event's assignees only.
  private async visibilityFilter(actor: Actor): Promise<Prisma.EventWhereInput | null> {
    if (actor.platformRole === 'ADMIN') return null;

    return {
      OR: [
        { status: { not: 'DRAFT' } },
        { club: { appointments: { some: { userId: actor.id, status: 'ACTIVE' } } } },
        { assignments: { some: { userId: actor.id } } },
      ],
    };
  }

  private async toDetail(actor: Actor, row: EventWithClub): Promise<EventDetail> {
    const registration = await this.host.tx.eventRegistration.findFirst({
      where: { eventId: row.id, userId: actor.id, status: { not: 'CANCELLED' } },
    });
    const { clubRoles } = await resolveClubFacts(this.host, actor.id, row.clubId);
    const { eventResponsibilities } = await resolveEventFacts(this.host, actor.id, row.id);

    return {
      ...toSummary(row),
      description: row.description,
      certificateEnabled: row.certificateEnabled,
      certificateTitle: row.certificateTitle,
      certificateSignatory: row.certificateSignatory,
      attendancePolicy: row.attendancePolicy,
      cancelledReason: row.cancelledReason,
      viewerRegistrationStatus: registration?.status ?? null,
      viewerWaitlistPosition: registration?.waitlistPosition ?? null,
      viewerClubRoles: clubRoles,
      viewerResponsibilities: eventResponsibilities,
    };
  }

  // Two gates: `event:edit` decided whether the actor may touch this event at
  // all, EVENT_FIELDS decides which keys of the body they may set.
  async update(actor: Actor, eventId: string, body: PatchEventBody): Promise<EventDetail> {
    await this.lifecycle.advance(eventId);

    return this.host.run(async () => {
      // The same row lock RegistrationsService.lockEvent takes, and taken first:
      // the reduction guard and the waitlist headroom both decide on
      // confirmedCount, which a concurrent registration is about to change.
      await this.host.tx.$queryRaw`SELECT 1 FROM "event" WHERE "id" = ${eventId}::uuid FOR UPDATE`;

      const event = await this.loadEvent(eventId);
      assertEventAcceptsEdits(event);

      // Re-derived from the database, not carried over from the guard: the field
      // gate is a second authorization decision.
      const { clubRoles } = await resolveClubFacts(this.host, actor.id, event.clubId);
      const facts = { platformRole: actor.platformRole, clubRoles };

      // overrideReason is a meta field, not a column, so it is held out of the
      // field gate: EVENT_FIELDS has no entry for it and would fail closed.
      const { overrideReason, ...fields } = body;
      assertFieldsAllowed(fields, EVENT_FIELDS, facts);
      const reason = overrideReasonFor(facts, overrideReason);

      const patch = body as Record<string, unknown>;
      const data: Record<string, unknown> = {};
      for (const key of PATCHABLE) {
        if (patch[key] !== undefined) data[key] = patch[key];
      }
      if (body.posterUploaded) data.bannerUrl = await this.clubs.verifyUpload('event-poster', eventId);

      const at = (key: keyof Windows): Date =>
        data[key] === undefined ? event[key] : new Date(data[key] as string);
      assertWindows({
        startsAt: at('startsAt'),
        endsAt: at('endsAt'),
        registrationOpensAt: at('registrationOpensAt'),
        registrationClosesAt: at('registrationClosesAt'),
      });

      // The lifecycle walks forward only, so a close time moved into the future
      // never returns the event to PUBLISHED. Accepting it silently would show
      // the officer a saved date and a shut door.
      if (
        body.registrationClosesAt !== undefined &&
        new Date(body.registrationClosesAt) > new Date() &&
        (event.status === 'REGISTRATION_CLOSED' || event.status === 'ONGOING')
      ) {
        throw new UnprocessableError('Registration cannot be reopened once it has closed.');
      }

      // Spec 7.4: capacity may not be reduced below the confirmed count. Refused
      // here for the message; event_capacity_bounds is still the guarantee.
      if (body.capacity !== undefined && body.capacity < event.confirmedCount) {
        throw new UnprocessableError(
          `Capacity cannot be lower than the ${event.confirmedCount} students already confirmed.`,
        );
      }

      const updated = await this.host.tx.event
        .update({ where: { id: eventId }, data })
        .catch(mapWriteError);

      // Raising capacity frees seats, the same as a cancellation freeing one.
      // Headroom is the new capacity minus the confirmed count, read under the
      // lock taken at the top of this transaction.
      if (body.capacity !== undefined && body.capacity > event.capacity) {
        await promoteFromWaitlist(
          this.host,
          this.audit,
          this.notifications,
          eventId,
          body.capacity - event.confirmedCount,
        );
      }

      await this.audit.record({
        action: 'event.updated',
        entityType: 'Event',
        entityId: eventId,
        outcome: 'SUCCESS',
        actorUserId: actor.id,
        ...(reason ? { reason } : {}),
        after: data,
      });

      // Spec 7.7. The dedupe subject carries the change's own timestamp, so a
      // second move of the date notifies again rather than being absorbed.
      const changed = materialChanges(event, data);
      if (changed.length > 0) {
        await this.notifyRegistered(eventId, 'event.changed', `${eventId}:${updated.updatedAt.toISOString()}`, {
          eventId,
          eventTitle: updated.title,
          clubId: event.clubId,
          changed,
          startsAt: updated.startsAt.toISOString(),
          endsAt: updated.endsAt.toISOString(),
          venue: updated.venue,
          onlineUrl: updated.onlineUrl,
          timezone: updated.timezone,
        });
      }

      return this.readDetail(actor, eventId);
    });
  }

  async publish(actor: Actor, eventId: string, body: PublishEventBody): Promise<EventDetail> {
    await this.host.run(async () => {
      const event = await this.loadEvent(eventId);
      // Spec 7.3: only an ACTIVE club may publish an event.
      assertAcceptsNewActivity(event.club.status);
      assertTransition(event.status, 'PUBLISHED');

      const reason = await clubOverrideReason(this.host, actor, event.clubId, body.overrideReason);

      await this.host.tx.event.update({ where: { id: eventId }, data: { status: 'PUBLISHED' } });
      await this.audit.record({
        action: 'event.published',
        entityType: 'Event',
        entityId: eventId,
        outcome: 'SUCCESS',
        actorUserId: actor.id,
        ...(reason ? { reason } : {}),
        before: { status: event.status },
        after: { status: 'PUBLISHED' },
      });

      // Spec 7.7: the club's active members, not every student. Officers are
      // already in this set, since accepting an appointment grants membership
      // too (spec 7.2).
      const members = await this.host.tx.clubMembership.findMany({
        where: { clubId: event.clubId, status: 'ACTIVE' },
        select: { userId: true },
      });
      await this.notifications.recordMany(
        members.map((m) => ({
          userId: m.userId,
          type: 'event.published' as const,
          subject: eventId,
          payload: {
            eventId,
            eventTitle: event.title,
            clubId: event.clubId,
            clubName: event.club.name,
            startsAt: event.startsAt.toISOString(),
          },
        })),
      );
    });

    // An event published after its registration window already opened and
    // closed is due to move on immediately.
    return this.detail(actor, eventId);
  }

  // Registration rows are left untouched: the event's status is what every gate
  // reads, and rewriting them would lose the record of who had been coming.
  async cancel(actor: Actor, eventId: string, body: CancelEventBody): Promise<EventDetail> {
    await this.host.run(async () => {
      const event = await this.host.tx.event.findUnique({ where: { id: eventId } });
      if (!event) throw new NotFoundError('No such event.');
      assertTransition(event.status, 'CANCELLED');

      await this.host.tx.event.update({
        where: { id: eventId },
        data: { status: 'CANCELLED', cancelledReason: body.reason },
      });
      await this.audit.record({
        action: 'event.cancelled',
        entityType: 'Event',
        entityId: eventId,
        outcome: 'SUCCESS',
        reason: body.reason,
        actorUserId: actor.id,
        before: { status: event.status },
        after: { status: 'CANCELLED' },
      });

      // Spec 7.7, event cancellation.
      await this.notifyRegistered(eventId, 'event.cancelled', eventId, {
        eventId,
        eventTitle: event.title,
        clubId: event.clubId,
        reason: body.reason,
        startsAt: event.startsAt.toISOString(),
      });
    });

    return this.readDetail(actor, eventId);
  }

  /**
   * Everyone still holding a place, notified inside the caller's transaction.
   * CANCELLED rows are excluded, having withdrawn; REMOVED rows are kept, since
   * an officer took that place away and a cancellation still concerns them.
   */
  private async notifyRegistered(
    eventId: string,
    type: 'event.changed' | 'event.cancelled',
    subject: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const holders = await this.host.tx.eventRegistration.findMany({
      where: { eventId, status: { not: 'CANCELLED' } },
      select: { userId: true },
    });
    await this.notifications.recordMany(
      holders.map((r) => ({ userId: r.userId, type, subject, payload })),
    );
  }
}
