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
  SignedUpload,
} from '@majlis/contracts';
import { v7 as uuidv7 } from 'uuid';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- value import: Nest DI resolves this from design:paramtypes.
import { AuditService } from '../audit/audit.service';
import { EVENT_FIELDS, assertFieldsAllowed, overrideReasonFor } from '../auth/field-permissions';
import type { PlatformRole } from '../auth/permissions';
import { resolveClubFacts, resolveEventFacts } from '../auth/permissions.guard';
import { assertAcceptsEdits, assertAcceptsNewActivity } from '../clubs/club-status';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- value import: see above.
import { ClubsService } from '../clubs/clubs.service';
import { deriveSlug, uniqueSlug } from '../clubs/slug';
import { ConflictError, NotFoundError, UnprocessableError } from '../common/problem/domain-error';
import { violatedConstraintName } from '../common/prisma-constraint';
import { Prisma, type Event as EventRow } from '../generated/prisma/client';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- value import: see above.
import { TransactionHost } from '../prisma/transaction.host';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- value import: see above.
import { EventLifecycleService } from './event-lifecycle.service';
import { assertTransition } from './event-status';
import { promoteFromWaitlist } from './waitlist';

const WITH_CLUB = { club: { select: { name: true, logoUrl: true, status: true } } } as const;
type EventWithClub = EventRow & { club: { name: string; logoUrl: string; status: 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED' } };

/** Only what a service reads off the signed-in user. */
interface Actor {
  id: string;
  platformRole: PlatformRole;
}

/**
 * The body keys a patch may write, derived from EVENT_FIELDS rather than
 * listed again — the two must describe the same set, and a second hand-kept
 * list would drift into a field that passes the permission gate and then
 * silently writes nothing.
 *
 * `posterUploaded` is excluded because it is not a column: it means "go
 * verify the object I uploaded", and the URL it produces is derived
 * server-side.
 */
const PATCHABLE = Object.keys(EVENT_FIELDS).filter((k) => k !== 'posterUploaded');

const DEFAULT_CHECK_IN_OPENS_BEFORE_MS = 60 * 60 * 1000;
const DEFAULT_CHECK_IN_CLOSES_AFTER_MS = 30 * 60 * 1000;

interface Windows {
  startsAt: Date;
  endsAt: Date;
  registrationOpensAt: Date;
  registrationClosesAt: Date;
  checkInOpensAt: Date;
  checkInClosesAt: Date;
}

/**
 * The same four rules as the CHECK constraints in the events migration,
 * applied to the MERGED row so a patch carrying one half of a pair is checked
 * against the stored other half. The database stays the guarantee; this is
 * what turns a constraint violation into a message naming what was wrong.
 */
function assertWindows(w: Windows): void {
  if (w.startsAt >= w.endsAt) throw new UnprocessableError('An event must end after it starts.');
  if (w.registrationOpensAt >= w.registrationClosesAt) {
    throw new UnprocessableError('Registration must close after it opens.');
  }
  if (w.registrationClosesAt > w.endsAt) {
    throw new UnprocessableError('Registration cannot close after the event ends.');
  }
  if (w.checkInOpensAt >= w.checkInClosesAt) {
    throw new UnprocessableError('Check-in must close after it opens.');
  }
}

function toSummary(row: EventWithClub): EventSummary {
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
    status: row.status,
  };
}

export { toSummary as toEventSummary, WITH_CLUB as EVENT_WITH_CLUB, type EventWithClub };

/**
 * `event_club_id_slug_key` is the only unique index on `event`, and the slug
 * reaching it is either derived from the title on create or supplied by a
 * Lead on patch. Either way the caller needs to be told which it was, not the
 * filter's generic conflict text.
 */
function mapWriteError(e: unknown): never {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
    if (violatedConstraintName(e.meta).includes('slug')) {
      throw new ConflictError('That club already has an event with that slug.');
    }
  }
  throw e;
}

@Injectable()
export class EventsService {
  constructor(
    private readonly host: TransactionHost,
    private readonly audit: AuditService,
    private readonly lifecycle: EventLifecycleService,
    private readonly clubs: ClubsService,
  ) {}

  /**
   * POST /clubs/:clubId/uploads/event-poster. Mints the id the event will be
   * created with, so the poster's object path exists before the event does.
   *
   * Club-scoped, unlike the club-logo equivalent, because `event:create` is
   * held by club Leads as well as Admin and PermissionsGuard can only resolve
   * a club role from a club id on the path.
   */
  async mintPosterUpload(): Promise<NewEventUpload> {
    const eventId = uuidv7();
    return { eventId, ...(await this.clubs.mintEditUpload(eventId, 'event-poster')) };
  }

  /**
   * POST /events/:eventId/poster-upload-url, for replacing an existing event's
   * poster.
   *
   * Gated on the same field permission as `posterUploaded`, not on the route's
   * `event:edit` alone. `event:edit` admits all five club roles, so without
   * this a CTO or Operations officer could mint a signed URL and overwrite the
   * live poster object they are not allowed to set.
   */
  async mintEditUpload(actor: Actor, eventId: string): Promise<SignedUpload> {
    const event = await this.host.tx.event.findUnique({
      where: { id: eventId },
      select: { clubId: true },
    });
    if (!event) throw new NotFoundError('No such event.');

    const { clubRoles } = await resolveClubFacts(this.host, actor.id, event.clubId);
    assertFieldsAllowed({ posterUploaded: true }, EVENT_FIELDS, {
      platformRole: actor.platformRole,
      clubRoles,
    });

    return this.clubs.mintEditUpload(eventId, 'event-poster');
  }

  async create(actor: Actor, clubId: string, body: CreateEventBody): Promise<EventDetail> {
    return this.host.run(async () => {
      const club = await this.host.tx.club.findUnique({ where: { id: clubId } });
      if (!club) throw new NotFoundError('No such club.');
      assertAcceptsNewActivity(club.status);

      const startsAt = new Date(body.startsAt);
      const endsAt = new Date(body.endsAt);
      const windows: Windows = {
        startsAt,
        endsAt,
        registrationOpensAt: new Date(body.registrationOpensAt),
        registrationClosesAt: new Date(body.registrationClosesAt),
        // Spec 5.1: the check-in window is explicit rather than magic, but it
        // has a default, which is what makes ONGOING a pure function of the
        // timestamps for an event nobody configured it on.
        checkInOpensAt: body.checkInOpensAt
          ? new Date(body.checkInOpensAt)
          : new Date(startsAt.getTime() - DEFAULT_CHECK_IN_OPENS_BEFORE_MS),
        checkInClosesAt: body.checkInClosesAt
          ? new Date(body.checkInClosesAt)
          : new Date(endsAt.getTime() + DEFAULT_CHECK_IN_CLOSES_AFTER_MS),
      };
      assertWindows(windows);

      const bannerUrl = body.posterUploaded
        ? await this.clubs.verifyUpload('event-poster', body.eventId)
        : null;

      // Unique per club, not globally (spec 5.1), so the count is scoped to
      // this club or two clubs could never both run an "Orientation".
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
        after: { clubId, title: row.title, slug: row.slug, capacity: row.capacity },
      });

      return this.toDetail(actor, row);
    });
  }

  /**
   * GET /events. Renders each row's status as stored rather than advancing
   * it: advancing a whole page would be one transaction per row on a read.
   * The sweep and every single-event read keep the stored value honest.
   */
  async list(actor: Actor, query: EventListQuery): Promise<EventPage> {
    const filters: Prisma.EventWhereInput = {
      ...(query.clubId ? { clubId: query.clubId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.q ? { title: { contains: query.q, mode: 'insensitive' as const } } : {}),
      ...(query.upcoming ? { endsAt: { gte: new Date() } } : {}),
    };
    const visible = await this.visibilityFilter(actor);

    const rows = await this.host.tx.event.findMany({
      where: visible ? { AND: [filters, visible] } : filters,
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      orderBy: { id: 'asc' },
      include: WITH_CLUB,
    });

    const hasMore = rows.length > query.limit;
    const items = hasMore ? rows.slice(0, query.limit) : rows;

    return {
      items: items.map(toSummary),
      nextCursor: hasMore ? items[items.length - 1]!.id : null,
    };
  }

  /** GET /events/:eventId. Advances first, so nobody reads a stale status. */
  async detail(actor: Actor, eventId: string): Promise<EventDetail> {
    await this.lifecycle.advance(eventId);
    return this.readDetail(actor, eventId);
  }

  private async readDetail(actor: Actor, eventId: string): Promise<EventDetail> {
    const visible = await this.visibilityFilter(actor);
    const row = await this.host.tx.event.findFirst({
      where: visible ? { AND: [{ id: eventId }, visible] } : { id: eventId },
      include: WITH_CLUB,
    });
    // A draft the viewer is not on the team of is a 404, not a 403: telling
    // them it exists is itself the leak.
    if (!row) throw new NotFoundError('No such event.');
    return this.toDetail(actor, row);
  }

  /**
   * Restricts a read to what `actor` may see, or null for no restriction at
   * all (Admin). DRAFT events are visible to their club's standing officers
   * and to anyone assigned to that specific event, and to nobody else.
   */
  private async visibilityFilter(actor: Actor): Promise<Prisma.EventWhereInput | null> {
    if (actor.platformRole === 'ADMIN') return null;

    const [appointments, assignments] = await Promise.all([
      this.host.tx.clubTeamAppointment.findMany({
        where: { userId: actor.id, status: 'ACTIVE' },
        select: { clubId: true },
      }),
      this.host.tx.eventAssignment.findMany({ where: { userId: actor.id }, select: { eventId: true } }),
    ]);

    return {
      OR: [
        { status: { not: 'DRAFT' } },
        { clubId: { in: appointments.map((a) => a.clubId) } },
        { id: { in: assignments.map((a) => a.eventId) } },
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
      checkInOpensAt: row.checkInOpensAt.toISOString(),
      checkInClosesAt: row.checkInClosesAt.toISOString(),
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

  /**
   * PATCH /events/:eventId. Two gates: `event:edit` decided whether the actor
   * may touch this event at all, and EVENT_FIELDS decides which keys of the
   * body they may set.
   */
  async update(actor: Actor, eventId: string, body: PatchEventBody): Promise<EventDetail> {
    await this.lifecycle.advance(eventId);

    return this.host.run(async () => {
      const event = await this.host.tx.event.findUnique({ where: { id: eventId }, include: WITH_CLUB });
      if (!event) throw new NotFoundError('No such event.');
      assertAcceptsEdits(event.club.status);
      if (event.status === 'CANCELLED' || event.status === 'COMPLETED' || event.status === 'CERTIFIED') {
        throw new UnprocessableError(`A ${event.status.toLowerCase()} event can no longer be edited.`);
      }

      // Re-derived here rather than carried over from the guard: the field
      // gate is a second authorization decision and trusts nothing the first
      // one left on the request.
      const { clubRoles } = await resolveClubFacts(this.host, actor.id, event.clubId);
      const facts = { platformRole: actor.platformRole, clubRoles };

      // overrideReason is a meta field, not a column, so it is held out of the
      // field gate (EVENT_FIELDS has no entry for it, which fails closed).
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
        checkInOpensAt: at('checkInOpensAt'),
        checkInClosesAt: at('checkInClosesAt'),
      });

      // Spec 7.4: capacity may not be reduced below the confirmed count.
      // Refused here with its own message rather than left to the
      // event_capacity_bounds CHECK, which would surface as a bare 409.
      if (body.capacity !== undefined && body.capacity < event.confirmedCount) {
        throw new UnprocessableError(
          `Capacity cannot be lower than the ${event.confirmedCount} students already confirmed.`,
        );
      }

      await this.host.tx.event.update({ where: { id: eventId }, data }).catch(mapWriteError);

      // Raising capacity frees seats, which is the same event as a
      // cancellation freeing one, and takes the same path. The update above
      // holds the event row lock, so a concurrent registration waits.
      if (body.capacity !== undefined && body.capacity > event.capacity) {
        await promoteFromWaitlist(this.host, this.audit, eventId, body.capacity - event.confirmedCount);
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

      return this.readDetail(actor, eventId);
    });
  }

  /** POST /events/:eventId/publish. One of the two operator-driven transitions. */
  async publish(actor: Actor, eventId: string): Promise<EventDetail> {
    await this.host.run(async () => {
      const event = await this.host.tx.event.findUnique({ where: { id: eventId }, include: WITH_CLUB });
      if (!event) throw new NotFoundError('No such event.');
      // Spec 7.3: only an ACTIVE club may publish an event.
      assertAcceptsNewActivity(event.club.status);
      assertTransition(event.status, 'PUBLISHED');

      await this.host.tx.event.update({ where: { id: eventId }, data: { status: 'PUBLISHED' } });
      await this.audit.record({
        action: 'event.published',
        entityType: 'Event',
        entityId: eventId,
        outcome: 'SUCCESS',
        actorUserId: actor.id,
        before: { status: event.status },
        after: { status: 'PUBLISHED' },
      });
    });

    // An event published after its registration window already opened and
    // closed is due to move on immediately.
    return this.detail(actor, eventId);
  }

  /**
   * POST /events/:eventId/cancel. Registration rows are left untouched: the
   * event's status is the source of truth and every gate reads it, so
   * rewriting thousands of registration rows would buy nothing and lose the
   * record of who had been coming.
   */
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
    });

    return this.readDetail(actor, eventId);
  }
}
