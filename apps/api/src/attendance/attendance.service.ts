import { Injectable } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- value import: Nest DI resolves this from design:paramtypes.
import { ConfigService } from '@nestjs/config';
import type {
  AttendanceListQuery,
  AttendancePage,
  CheckInResult,
  CorrectAttendanceBody,
  ManualCheckInBody,
  ScanBody,
} from '@majlis/contracts';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- value import: see above.
import { AuditService } from '../audit/audit.service';
import type { PlatformRole } from '../auth/permissions';
import { cursorArgs, cursorPage } from '../common/cursor-page';
import { violatedConstraintName } from '../common/prisma-constraint';
import { NotFoundError, UnprocessableError } from '../common/problem/domain-error';
import type { Env } from '../config/env.schema';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- value import: see above.
import { EventLifecycleService } from '../events/event-lifecycle.service';
import { Prisma, type AttendanceMethod } from '../generated/prisma/client';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- value import: see above.
import { TransactionHost } from '../prisma/transaction.host';
import { verifyPass } from './qr-token';

const HOUR_MS = 60 * 60 * 1000;

/**
 * Registrations that held a confirmed place, whatever became of them. This
 * is the denominator the scanner's counter shows, and the set the roster's
 * `expected` counts: a waitlisted student was never expected in the room.
 */
const EXPECTED = ['CONFIRMED', 'CHECKED_IN', 'ATTENDED', 'NO_SHOW'] as const;

/**
 * Statuses a scan may check in. NO_SHOW is here because a correction can put
 * a registration back into it while the event is still open, and the person
 * arriving late should scan like anyone else.
 *
 * WAITLISTED is deliberately absent: spec 7.5 step 5 requires a confirmed
 * place. The operator is answered NOT_REGISTERED, because the six results
 * carry no "waitlisted" case and the action is the same either way — that
 * person holds no place at this event.
 */
const CHECKABLE = ['CONFIRMED', 'NO_SHOW'] as const;

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
    config: ConfigService<Env, true>,
  ) {
    this.secret = config.get('QR_SIGNING_SECRET', { infer: true });
    this.correctionWindowMs = config.get('ATTENDANCE_CORRECTION_WINDOW_HOURS', { infer: true }) * HOUR_MS;
  }

  /**
   * POST /events/:eventId/check-in/scan. Six of spec 7.5's seven outcomes
   * are a 200 with a `result` discriminant, because they are things the
   * operator has to read and act on rather than faults in their request.
   * The seventh, "not authorised to scan this event", is a 403 written by
   * PermissionsGuard before this ever runs.
   */
  async scan(actor: Actor, eventId: string, body: ScanBody): Promise<CheckInResult> {
    const verified = verifyPass(body.token, this.secret);
    // Neither the reason nor anything else about the token reaches the
    // operator: a forged pass and a superseded one look identical to them,
    // which is the point.
    if (!verified.ok) return { result: 'INVALID_PASS' };

    const pass = await this.host.tx.qrPass.findUnique({ where: { userId: verified.payload.userId } });
    // Rotation dies here. The version is inside the signed payload, so an
    // image printed before a rotation still verifies and still fails.
    if (!pass || pass.tokenVersion !== verified.payload.tokenVersion) return { result: 'INVALID_PASS' };

    return this.checkIn(actor, eventId, verified.payload.userId, {
      method: 'QR_SCAN',
      deviceHint: body.deviceHint,
    });
  }

  /**
   * POST /events/:eventId/check-in/manual. The fallback when a camera fails,
   * keyed by the email the operator can read off the student rather than by
   * a second credential format (decided 2026-09-12). Same result union, and
   * a reason that is required and audited.
   */
  async manual(actor: Actor, eventId: string, body: ManualCheckInBody): Promise<CheckInResult> {
    const user = await this.host.tx.user.findUnique({ where: { email: body.email }, select: { id: true } });
    // An address with no account is answered exactly like an address with an
    // account and no registration. The check-in screen is not an oracle for
    // who has signed up for Majlis.
    if (!user) return { result: 'NOT_REGISTERED' };

    return this.checkIn(actor, eventId, user.id, { method: 'MANUAL', manualReason: body.reason });
  }

  /**
   * The shared body of both routes, and the transaction spec 7.5 describes:
   * the attendance row, the registration's new status and the audit row all
   * commit together or none of them do.
   *
   * `advance()` runs BEFORE the transaction opens, per the warning in its
   * own docblock: inside one it would join this transaction, and there is no
   * refusal here that must not roll it back.
   */
  private async checkIn(
    actor: Actor,
    eventId: string,
    userId: string,
    recording: Recording,
  ): Promise<CheckInResult> {
    await this.lifecycle.advance(eventId);

    try {
      return await this.host.run(() => this.checkInTx(actor, eventId, userId, recording));
    } catch (e) {
      // attendance_record_registration_id_key. Two operators scanning the
      // same person at the same instant is an ordinary event in a queue, not
      // a fault: the index is what makes one of them lose, and this is what
      // turns losing into the answer the operator needed anyway.
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002' &&
        violatedConstraintName(e.meta).includes('attendance_record_registration_id')
      ) {
        const already = await this.alreadyCheckedIn(eventId, userId);
        if (already) return already;
      }
      throw e;
    }
  }

  private async checkInTx(
    actor: Actor,
    eventId: string,
    userId: string,
    recording: Recording,
  ): Promise<CheckInResult> {
    const event = await this.host.tx.event.findUnique({
      where: { id: eventId },
      select: EVENT_FOR_CHECK_IN,
    });
    if (!event) throw new NotFoundError('No such event.');

    const now = new Date();
    if (event.status !== 'ONGOING' || now < event.checkInOpensAt || now > event.checkInClosesAt) {
      return { result: 'EVENT_NOT_OPEN', eventStatus: event.status };
    }

    const user = await this.host.tx.user.findUnique({
      where: { id: userId },
      select: { status: true, fullName: true, email: true },
    });
    // A suspended holder and a suspended club both answer INVALID_PASS, and
    // deliberately not a message that would confirm the person exists or
    // name them to whoever is holding the scanner.
    if (!user || user.status !== 'ACTIVE' || event.club.status !== 'ACTIVE') {
      return { result: 'INVALID_PASS' };
    }

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

  /** The answer to a scan that lost the race for the unique index. */
  private async alreadyCheckedIn(eventId: string, userId: string): Promise<CheckInResult | null> {
    const record = await this.host.tx.attendanceRecord.findFirst({
      where: { eventId, userId },
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
        after: { status, present: body.present },
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
