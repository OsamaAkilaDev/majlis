import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  AttendanceListQuery,
  AttendancePage,
  CheckInResult,
  CorrectAttendanceBody,
  ManualCheckInBody,
  ScanBody,
} from '@majlis/contracts';
import { AuditService } from '../audit/audit.service';
import type { PlatformRole } from '../auth/permissions';
import { CertificatesService } from '../certificates/certificates.service';
import { cursorArgs, cursorPage } from '../common/cursor-page';
import { violatedConstraintName } from '../common/prisma-constraint';
import { NotFoundError, UnprocessableError } from '../common/problem/domain-error';
import type { Env } from '../config/env.schema';
import { EventLifecycleService, type LifecycleRow } from '../events/event-lifecycle.service';
import { Prisma, type AttendanceMethod } from '../generated/prisma/client';
import { TransactionHost } from '../prisma/transaction.host';
import { verifyPass } from './qr-token';

const HOUR_MS = 60 * 60 * 1000;

/** Registrations that held a confirmed place, whatever became of them: a
 *  waitlisted student was never expected in the room. */
const EXPECTED = ['CONFIRMED', 'CHECKED_IN', 'ATTENDED', 'NO_SHOW'] as const;

/**
 * Spec 7.5 step 5 requires a confirmed place, and CONFIRMED is the only
 * status that is one.
 *
 * NO_SHOW is absent deliberately: admitting it would let a scan resurrect a
 * closed event's absentee if the writers of that status ever changed.
 * WAITLISTED is absent too, answered NOT_REGISTERED, since the action is the
 * same either way: that person holds no place here.
 */
const CHECKABLE = ['CONFIRMED'] as const;

/**
 * Everything else is refused rather than overwritten:
 *
 * - CANCELLED and REMOVED would be resurrected as CHECKED_IN, making a
 *   withdrawn student certificate-eligible, or collide with their second
 *   open row on event_registration_one_open_per_user as a bare 409.
 * - WAITLISTED would become CHECKED_IN without incrementing
 *   Event.confirmedCount, diverging the counter the
 *   `capacity >= confirmed_count` CHECK guards.
 */
const CORRECTABLE = ['CONFIRMED', 'CHECKED_IN', 'ATTENDED', 'NO_SHOW'] as const;

/** Why each refused status is refused, in the officer's own terms. */
const NOT_CORRECTABLE: Record<string, string> = {
  CANCELLED: 'That student cancelled their registration, so there is no attendance to correct.',
  REMOVED: 'That student was removed from the event, so there is no attendance to correct.',
  WAITLISTED: 'That student was on the waiting list and never held a place at the event.',
};

const WITH_USER = { user: { select: { fullName: true, email: true } } } as const;

interface Actor {
  id: string;
  platformRole: PlatformRole;
}

const EVENT_FOR_CHECK_IN = {
  id: true,
  status: true,
  endsAt: true,
  checkInOpensAt: true,
  checkInClosesAt: true,
  club: { select: { status: true } },
} as const;

type CheckInEvent = Prisma.EventGetPayload<{ select: typeof EVENT_FOR_CHECK_IN }>;

/** Stays UNRESOLVED until checkInTx has passed the event gate, so no refusal
 *  before that point can vary on whether the subject exists. */
type Subject = { userId: string } | { email: string };

/** What a successful scan records beyond the registration it is for. */
interface Recording {
  method: AttendanceMethod;
  deviceHint?: string | undefined;
  manualReason?: string | undefined;
}

@Injectable()
export class AttendanceService {
  private readonly secret: string;
  private readonly correctionWindowMs: number;

  constructor(
    private readonly host: TransactionHost,
    private readonly audit: AuditService,
    private readonly lifecycle: EventLifecycleService,
    private readonly certificates: CertificatesService,
    config: ConfigService<Env, true>,
  ) {
    this.secret = config.get('QR_SIGNING_SECRET', { infer: true });
    this.correctionWindowMs = config.get('ATTENDANCE_CORRECTION_WINDOW_HOURS', { infer: true }) * HOUR_MS;
  }

  /** Six of spec 7.5's seven outcomes are a 200 with a `result`
   *  discriminant: things the operator acts on, not faults in the request.
   *  The seventh is a 403 from PermissionsGuard before this runs. */
  async scan(actor: Actor, eventId: string, body: ScanBody): Promise<CheckInResult> {
    const verified = verifyPass(body.token, this.secret);
    // Nothing about the token reaches the operator: a forged pass and a
    // superseded one look identical, which is the point.
    if (!verified.ok) return { result: 'INVALID_PASS' };

    const pass = await this.host.tx.qrPass.findUnique({ where: { userId: verified.payload.userId } });
    // Rotation dies here. The version is inside the signed payload, so an
    // image printed before a rotation still verifies and still fails.
    if (!pass || pass.tokenVersion !== verified.payload.tokenVersion) return { result: 'INVALID_PASS' };

    return this.checkIn(actor, eventId, { userId: verified.payload.userId }, {
      method: 'QR_SCAN',
      deviceHint: body.deviceHint,
    });
  }

  /** The camera fallback, keyed by email rather than a second credential
   *  format (decided 2026-09-12). The reason is required and audited. */
  async manual(actor: Actor, eventId: string, body: ManualCheckInBody): Promise<CheckInResult> {
    // Resolved inside checkInTx, AFTER the event gate, never here. Resolving
    // first made this an account-existence oracle: an unknown address
    // answered NOT_REGISTERED while a known one reached the window check and
    // answered EVENT_NOT_OPEN, which is most events most of the time.
    return this.checkIn(actor, eventId, { email: body.email }, {
      method: 'MANUAL',
      manualReason: body.reason,
    });
  }

  /**
   * Spec 7.5's transaction: the attendance row, the registration's new status
   * and the audit row all commit together or none do.
   *
   * The advance runs BEFORE the transaction opens, per its own docblock:
   * inside one it would join this transaction, and there is no refusal here
   * that must not roll it back.
   */
  private async checkIn(
    actor: Actor,
    eventId: string,
    subject: Subject,
    recording: Recording,
  ): Promise<CheckInResult> {
    const event = await this.lifecycle.advanceAndRead(eventId);

    try {
      return await this.host.run(() => this.checkInTx(actor, event, subject, recording));
    } catch (e) {
      // attendance_record_registration_id_key. Two operators scanning one
      // person at the same instant is ordinary in a queue: the index makes
      // one lose, and this turns losing into the answer they needed anyway.
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002' &&
        violatedConstraintName(e.meta).includes('attendance_record_registration_id')
      ) {
        const already = await this.alreadyCheckedIn(eventId, subject);
        if (already) return already;
      }
      throw e;
    }
  }

  private async checkInTx(
    actor: Actor,
    event: LifecycleRow,
    subject: Subject,
    recording: Recording,
  ): Promise<CheckInResult> {
    const eventId = event.id;

    const now = new Date();
    if (event.status !== 'ONGOING' || now < event.checkInOpensAt || now > event.checkInClosesAt) {
      return { result: 'EVENT_NOT_OPEN', eventStatus: event.status };
    }
    // A suspended club freezes the event for everybody, so this answer does
    // not vary with who was presented and is safe to give before the lookup.
    // Its own statement: the event row arrived from the advance, and pulling
    // the club through a relation would have been a second query anyway.
    const club = await this.host.tx.club.findUnique({
      where: { id: event.clubId },
      select: { status: true },
    });
    if (club?.status !== 'ACTIVE') return { result: 'INVALID_PASS' };

    const user = await this.host.tx.user.findUnique({
      where: 'userId' in subject ? { id: subject.userId } : { email: subject.email },
      select: { id: true, status: true, fullName: true, email: true },
    });
    // Every refusal from here down is the SAME answer whether the subject
    // has no account, a suspended one, or an active one with no place at
    // this event. Splitting them makes the screen an oracle for who holds a
    // Majlis account, and manual check-in takes an arbitrary address from
    // any club Operations officer, so the set probed need have nothing to do
    // with the event they hold a role in.
    //
    // Which answer differs by route, and only because the operator sees it:
    // a scan is a pass that did not work, a typed address is a person with
    // no place here. Neither varies on account existence.
    const missing: CheckInResult =
      recording.method === 'MANUAL' ? { result: 'NOT_REGISTERED' } : { result: 'INVALID_PASS' };
    if (!user || user.status !== 'ACTIVE') return missing;

    const userId = user.id;

    // One query rather than a filtered lookup and then a second one on the
    // miss: only CANCELLED is excluded from the partial unique index, so a
    // student may hold at most one open row plus any number of cancelled
    // ones, and "registered then cancelled" has to be distinguishable from
    // "never registered".
    const rows = await this.host.tx.eventRegistration.findMany({ where: { eventId, userId } });
    const open = rows.find((r) => r.status !== 'CANCELLED');
    if (!open) return { result: rows.length > 0 ? 'REGISTRATION_CANCELLED' : 'NOT_REGISTERED' };
    if (open.status === 'REMOVED') return { result: 'REGISTRATION_CANCELLED' };

    const existing = await this.host.tx.attendanceRecord.findUnique({
      where: { registrationId: open.id },
    });
    // The ORIGINAL time, never a fresh one and never a second record: the
    // operator's question is whether this person has already been through
    // the door, and a rewritten timestamp answers it wrongly.
    if (existing) {
      return {
        result: 'ALREADY_CHECKED_IN',
        fullName: user.fullName,
        email: user.email,
        checkedInAt: existing.checkedInAt.toISOString(),
      };
    }
    if (!(CHECKABLE as readonly string[]).includes(open.status)) return { result: 'NOT_REGISTERED' };

    const record = await this.host.tx.attendanceRecord.create({
      data: {
        registrationId: open.id,
        eventId,
        userId,
        checkedInById: actor.id,
        method: recording.method,
        deviceHint: recording.deviceHint ?? null,
        manualReason: recording.manualReason ?? null,
      },
    });

    await this.host.tx.eventRegistration.update({
      where: { id: open.id },
      data: { status: 'CHECKED_IN' },
    });

    await this.audit.record({
      action: recording.method === 'MANUAL' ? 'attendance.manual_check_in' : 'attendance.scanned',
      entityType: 'AttendanceRecord',
      entityId: record.id,
      outcome: 'SUCCESS',
      actorUserId: actor.id,
      ...(recording.manualReason ? { reason: recording.manualReason } : {}),
      before: { status: open.status },
      after: { status: 'CHECKED_IN', eventId, userId, method: recording.method },
    });

    return {
      result: 'CHECKED_IN',
      fullName: user.fullName,
      email: user.email,
      checkedInAt: record.checkedInAt.toISOString(),
    };
  }

  /**
   * The answer to a scan that lost the race for the unique index. Resolving
   * the subject here discloses nothing: a P2002 on that index is proof the
   * row already exists.
   */
  private async alreadyCheckedIn(eventId: string, subject: Subject): Promise<CheckInResult | null> {
    const record = await this.host.tx.attendanceRecord.findFirst({
      where: {
        eventId,
        ...('userId' in subject ? { userId: subject.userId } : { user: { email: subject.email } }),
      },
      include: WITH_USER,
    });
    if (!record) return null;

    return {
      result: 'ALREADY_CHECKED_IN',
      fullName: record.user.fullName,
      email: record.user.email,
      checkedInAt: record.checkedInAt.toISOString(),
    };
  }

  /**
   * GET /events/:eventId/attendance. Behind `registration:read`, not
   * `attendance:scan`: this is a bulk read of attendee personal data, and
   * spec 6.1 keeps Marketing and CTO out of it entirely.
   */
  async roster(eventId: string, query: AttendanceListQuery): Promise<AttendancePage> {
    const rows = await this.host.tx.eventRegistration.findMany({
      where: { eventId, status: { not: 'CANCELLED' } },
      ...cursorArgs(query),
      include: { ...WITH_USER, attendance: true },
    });

    const { items, nextCursor } = cursorPage(rows, query.limit);

    const [checkedIn, expected] = await Promise.all([
      this.host.tx.attendanceRecord.count({ where: { eventId } }),
      this.host.tx.eventRegistration.count({ where: { eventId, status: { in: [...EXPECTED] } } }),
    ]);

    return {
      items: items.map((r) => ({
        id: r.id,
        userId: r.userId,
        fullName: r.user.fullName,
        email: r.user.email,
        registrationStatus: r.status,
        checkedInAt: r.attendance?.checkedInAt.toISOString() ?? null,
        method: r.attendance?.method ?? null,
      })),
      nextCursor,
      checkedIn,
      expected,
    };
  }

  /**
   * PATCH /events/:eventId/attendance/:registrationId. Spec 7.5's
   * correction: time-bound to the window after the event ends, Admin-only
   * past it and once the event is CERTIFIED, and always writing before and
   * after to the audit log.
   *
   * `present` is the state being asserted rather than a toggle, so a
   * correction that is retried lands on the same answer.
   */
  async correct(
    actor: Actor,
    eventId: string,
    registrationId: string,
    body: CorrectAttendanceBody,
  ): Promise<void> {
    await this.lifecycle.advance(eventId);

    return this.host.run(async () => {
      // Both ids, not the bare row id: an event-scoped permission cannot
      // authorize a registration that belongs to some other event.
      const registration = await this.host.tx.eventRegistration.findFirst({
        where: { id: registrationId, eventId },
      });
      if (!registration) throw new NotFoundError('No such registration for that event.');

      const event = await this.host.tx.event.findUniqueOrThrow({
        where: { id: eventId },
        select: EVENT_FOR_CHECK_IN,
      });

      const override = this.assertCorrectable(actor, event, body);

      if (!(CORRECTABLE as readonly string[]).includes(registration.status)) {
        throw new UnprocessableError(
          NOT_CORRECTABLE[registration.status] ?? 'That registration has no attendance to correct.',
        );
      }

      const record = await this.host.tx.attendanceRecord.findUnique({ where: { registrationId } });
      const now = new Date();

      if (body.present) {
        // An upsert rather than a create: a correction to "present" for
        // someone who already has a record is a no-op on the record and
        // still has to put the registration back, which is the case a
        // create would turn into a 409 on the officer's screen.
        await this.host.tx.attendanceRecord.upsert({
          where: { registrationId },
          create: {
            registrationId,
            eventId,
            userId: registration.userId,
            checkedInById: actor.id,
            method: 'MANUAL',
            manualReason: body.reason,
            correctedAt: now,
            correctedById: actor.id,
            correctionReason: body.reason,
          },
          update: { correctedAt: now, correctedById: actor.id, correctionReason: body.reason },
        });
      } else if (record) {
        // The record is what every count, the roster and certificate
        // eligibility all read, so "not present" has to remove it or the
        // three disagree. The before-snapshot on the audit row below is
        // where the removed row survives, in an append-only table.
        await this.host.tx.attendanceRecord.delete({ where: { registrationId } });
      }

      const status = body.present ? 'CHECKED_IN' : event.status === 'ONGOING' ? 'CONFIRMED' : 'NO_SHOW';
      await this.host.tx.eventRegistration.update({ where: { id: registrationId }, data: { status } });

      // A correction that records someone as absent has to take their
      // certificate with it, in this transaction. assertCorrectable lets an
      // Admin correct after CERTIFIED, and without this /verify would keep
      // answering ACTIVE, with that student's name, for a person the system
      // now records as not having been there.
      const certificateRevoked = body.present
        ? false
        : await this.certificates.revokeForRegistration(actor, registrationId, body.reason);

      await this.audit.record({
        action: 'attendance.corrected',
        entityType: 'EventRegistration',
        entityId: registrationId,
        outcome: 'SUCCESS',
        reason: body.reason,
        actorUserId: actor.id,
        before: {
          status: registration.status,
          checkedInAt: record?.checkedInAt.toISOString() ?? null,
          ...(override ? { override } : {}),
        },
        after: { status, present: body.present, ...(certificateRevoked ? { certificateRevoked } : {}) },
      });
    });
  }

  /**
   * The window of spec 7.5, and the two ways past it. Returns the Admin's
   * override reason when one was needed, so the audit row records that the
   * correction was an override rather than an ordinary one.
   */
  private assertCorrectable(
    actor: Actor,
    event: CheckInEvent,
    body: CorrectAttendanceBody,
  ): string | undefined {
    const admin = actor.platformRole === 'ADMIN';
    const closed = Date.now() > event.endsAt.getTime() + this.correctionWindowMs;
    const locked = event.status === 'CERTIFIED';
    if (!closed && !locked) return undefined;

    if (!admin) {
      throw new UnprocessableError(
        locked
          ? 'That event has issued certificates and its attendance is locked.'
          : 'The window for correcting attendance on that event has closed.',
      );
    }
    if (!body.override?.reason) {
      throw new UnprocessableError(
        'Correcting attendance after the window has closed requires an override reason.',
      );
    }
    return body.override.reason;
  }
}
