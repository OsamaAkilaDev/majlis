import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  Certificate,
  CertificateIssueResult,
  CertificateListQuery,
  CertificatePage,
  CertificatePdf,
  ReissueCertificateBody,
  RevokeCertificateBody,
  Verification,
} from '@majlis/contracts';
import { AuditService } from '../audit/audit.service';
import type { PlatformRole } from '../auth/permissions';
import { cursorArgs, cursorPage } from '../common/cursor-page';
import { violatedConstraintName } from '../common/prisma-constraint';
import { ForbiddenError, NotFoundError, UnprocessableError } from '../common/problem/domain-error';
import type { Env } from '../config/env.schema';
import { assertTransition } from '../events/event-status';
import { Prisma, type Certificate as CertificateRow } from '../generated/prisma/client';
import { NotificationService } from '../notifications/notification.service';
import { TransactionHost } from '../prisma/transaction.host';
import { StorageService } from '../storage/storage.service';
import { CERTIFICATE_BUCKET, certificatePdfPath } from '../storage/image-kinds';
import { serialNumber, verificationCode } from './certificate-codes';
import { renderCertificate } from './certificate-pdf';

/** Eligibility per `attendance_policy` (spec 7.6). A later policy gets its
 *  own entry here rather than an `if`. */
const ELIGIBLE = {
  CHECK_IN_ONLY: ['CHECKED_IN', 'ATTENDED'],
} as const satisfies Record<string, readonly string[]>;

/** A code collision is astronomically unlikely and still has to be
 *  survivable: retried with fresh codes rather than answering 500. */
const INSERT_ATTEMPTS = 3;

/** Long enough to follow the URL, short enough that one leaked through a
 *  history entry or a referrer header is already dead. */
const PDF_URL_TTL_SECONDS = 300;

const EVENT_FOR_ISSUE = {
  id: true,
  title: true,
  status: true,
  endsAt: true,
  certificateEnabled: true,
  certificateTitle: true,
  certificateSignatory: true,
  attendancePolicy: true,
  club: { select: { name: true, logoUrl: true } },
} as const;

type IssuableEvent = Prisma.EventGetPayload<{ select: typeof EVENT_FOR_ISSUE }>;

interface Actor {
  id: string;
  platformRole: PlatformRole;
}

/**
 * Deliberately NOT `certificate_one_active_per_registration`: that means
 * somebody else already issued this registration's certificate, and retrying
 * would burn every attempt before answering the conflict it always was.
 */
function isCodeCollision(e: unknown): boolean {
  if (!(e instanceof Prisma.PrismaClientKnownRequestError) || e.code !== 'P2002') return false;
  const constraint = violatedConstraintName(e.meta);
  return constraint.includes('certificate_serial_number') || constraint.includes('certificate_verification_code');
}

function toCertificate(row: CertificateRow): Certificate {
  return {
    id: row.id,
    eventId: row.eventId,
    userId: row.userId,
    serialNumber: row.serialNumber,
    verificationCode: row.verificationCode,
    status: row.status,
    holderName: row.holderNameSnapshot,
    eventTitle: row.eventTitleSnapshot,
    clubName: row.clubNameSnapshot,
    clubLogoUrl: row.clubLogoSnapshotUrl,
    issuedAt: row.issuedAt.toISOString(),
    revokedAt: row.revokedAt?.toISOString() ?? null,
    revokedReason: row.revokedReason,
  };
}

@Injectable()
export class CertificatesService {
  private readonly webOrigin: string;

  constructor(
    private readonly host: TransactionHost,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
    private readonly notifications: NotificationService,
    config: ConfigService<Env, true>,
  ) {
    this.webOrigin = config.get('PUBLIC_WEB_ORIGIN', { infer: true }).replace(/\/+$/, '');
  }

  /** The only issuance path: somebody presses the button. Nothing issues on
   *  a timer or a page view, because attendance stays correctable until it
   *  does (ruled 2026-09-24). */
  async issue(eventId: string): Promise<CertificateIssueResult> {
    const event = await this.host.tx.event.findUnique({
      where: { id: eventId },
      select: EVENT_FOR_ISSUE,
    });
    if (!event) throw new NotFoundError('No such event.');

    const refusal = this.notIssuableReason(event);
    if (refusal) throw new UnprocessableError(refusal);
    return this.issueCore(event);
  }

  /**
   * CERTIFIED is NOT a refusal: issuance is idempotent (spec 7.6), so a
   * second press must be a no-op rather than an error.
   *
   * No clock gate: COMPLETED is enough. Attendance corrections are open until
   * CERTIFIED rather than for a fixed window, so waiting protects nothing.
   */
  private notIssuableReason(event: IssuableEvent): string | null {
    if (!event.certificateEnabled) return 'That event does not issue certificates.';
    if (event.status === 'CERTIFIED') return null;
    if (event.status !== 'COMPLETED') return 'That event has not finished yet.';
    return null;
  }

  private async issueCore(event: IssuableEvent): Promise<CertificateIssueResult> {
    return this.host.run(async () => {
      let issued = 0;

      for (let attempt = 0; attempt < INSERT_ATTEMPTS; attempt += 1) {
        const pending = await this.host.tx.eventRegistration.findMany({
          where: {
            eventId: event.id,
            status: { in: [...ELIGIBLE[event.attendancePolicy]] },
            // The partial unique index is the guarantee; this keeps the
            // common second run from having to rely on it.
            certificates: { none: { status: 'ACTIVE' } },
          },
          include: { user: { select: { fullName: true } } },
        });
        if (pending.length === 0) break;

        // skipDuplicates is ON CONFLICT DO NOTHING, which absorbs a
        // concurrent run's rows INSIDE the transaction. A bare P2002 could
        // not be absorbed here at all: Postgres aborts the whole transaction
        // on a constraint violation, so catching it would only reach a
        // connection that refuses every subsequent statement.
        const { count } = await this.host.tx.certificate.createMany({
          data: pending.map((r) => this.newRow(event, r.id, r.userId, r.user.fullName)),
          skipDuplicates: true,
        });
        issued += count;
        // Everything asked for landed. Anything short is either a concurrent
        // run or a code collision, and the next pass re-reads which is which
        // rather than guessing.
        if (count === pending.length) break;
      }

      // Read back rather than derived from `issued`: createMany returns a
      // count, not ids, and a concurrent run's rows are part of this event's
      // total too. Spec 7.7's certificate-issued notification needs the ids
      // anyway, and the dedupe key absorbs the re-notification a second,
      // idempotent press of the button would otherwise produce.
      const active = await this.host.tx.certificate.findMany({
        where: { eventId: event.id, status: 'ACTIVE' },
        select: { id: true, userId: true, serialNumber: true },
      });
      const total = active.length;

      await this.notifications.recordMany(
        active.map((c) => ({
          userId: c.userId,
          type: 'certificate.issued' as const,
          subject: c.id,
          payload: {
            certificateId: c.id,
            eventId: event.id,
            eventTitle: event.title,
            serialNumber: c.serialNumber,
          },
        })),
      );

      if (event.status === 'COMPLETED') {
        assertTransition(event.status, 'CERTIFIED');
        // Conditional, like every other lifecycle write: a concurrent run
        // that got there first must not produce a second audit row.
        const { count } = await this.host.tx.event.updateMany({
          where: { id: event.id, status: 'COMPLETED' },
          data: { status: 'CERTIFIED' },
        });
        if (count > 0) {
          await this.audit.record({
            action: 'certificate.issued_for_event',
            entityType: 'Event',
            entityId: event.id,
            outcome: 'SUCCESS',
            before: { status: 'COMPLETED' },
            after: { status: 'CERTIFIED', issued, total },
          });
        }
      }

      return { issued, total };
    });
  }

  /** All four snapshot columns, filled at issuance and never updated after. */
  private newRow(
    event: IssuableEvent,
    registrationId: string,
    userId: string,
    fullName: string,
  ): Prisma.CertificateCreateManyInput {
    return {
      registrationId,
      eventId: event.id,
      userId,
      serialNumber: serialNumber(),
      verificationCode: verificationCode(),
      holderNameSnapshot: fullName,
      eventTitleSnapshot: event.title,
      clubNameSnapshot: event.club.name,
      clubLogoSnapshotUrl: event.club.logoUrl,
    };
  }

  /** GET /events/:eventId/certificates. Behind `registration:read`. */
  async forEvent(eventId: string, query: CertificateListQuery): Promise<CertificatePage> {
    const rows = await this.host.tx.certificate.findMany({
      where: { eventId },
      ...cursorArgs(query),
    });
    const { items, nextCursor } = cursorPage(rows, query.limit);
    return { items: items.map(toCertificate), nextCursor };
  }

  /**
   * GET /me/certificates. Self-scoped by `userId`; no permission key.
   *
   * Newest first: the document a holder came for is the one just issued, and
   * an oldest-first list puts it behind every page of their history.
   */
  async mine(actor: Actor, query: CertificateListQuery): Promise<CertificatePage> {
    const rows = await this.host.tx.certificate.findMany({
      where: { userId: actor.id },
      ...cursorArgs(query, 'desc'),
    });
    const { items, nextCursor } = cursorPage(rows, query.limit);
    return { items: items.map(toCertificate), nextCursor };
  }

  /**
   * GET /certificates/:id/pdf. Rendered on the first call and uploaded, so
   * issuing a thousand certificates does not render a thousand PDFs nobody
   * asked for (spec 7.6).
   *
   * Ownership, not a permission key: the holder or an Admin, and nobody
   * else. A club officer who may list an event's certificates still has no
   * business downloading somebody's document.
   */
  async pdf(actor: Actor, certificateId: string): Promise<CertificatePdf> {
    const row = await this.host.tx.certificate.findUnique({ where: { id: certificateId } });
    if (!row) throw new NotFoundError('No such certificate.');
    if (row.userId !== actor.id && actor.platformRole !== 'ADMIN') {
      throw new ForbiddenError('That certificate belongs to someone else.');
    }

    const path = certificatePdfPath(row.id);
    if (!row.pdfUrl) await this.render(row, path);

    // Signed, never public. The object path is a pure function of the
    // certificate id and every holder of `registration:read` can list those
    // ids, so a public URL would make the ownership check above decorative.
    try {
      return { pdfUrl: await this.sign(path) };
    } catch {
      // `pdfUrl` marks that a render happened, which is not the same as the
      // object still being there: a certificate rendered before certificates
      // moved to their own bucket, or an object deleted out from under us,
      // leaves the marker set and the bytes gone, and signing a path with
      // nothing behind it answers 400. Re-render once rather than let a
      // credential download 500 forever with no way back.
      await this.render(row, path);
      return { pdfUrl: await this.sign(path) };
    }
  }

  private sign(path: string): Promise<string> {
    return this.storage.createSignedDownloadUrl(path, PDF_URL_TTL_SECONDS, CERTIFICATE_BUCKET);
  }

  /** Renders the document, stores it, and marks the row as rendered. */
  private async render(row: CertificateRow, path: string): Promise<void> {
    const event = await this.host.tx.event.findUniqueOrThrow({
      where: { id: row.eventId },
      select: { certificateTitle: true, certificateSignatory: true },
    });

    const bytes = await renderCertificate({
      serialNumber: row.serialNumber,
      verificationCode: row.verificationCode,
      holderName: row.holderNameSnapshot,
      eventTitle: row.eventTitleSnapshot,
      clubName: row.clubNameSnapshot,
      clubLogoUrl: row.clubLogoSnapshotUrl,
      issuedAt: row.issuedAt,
      certificateTitle: event.certificateTitle ?? 'Certificate of Attendance',
      signatory: event.certificateSignatory,
      verifyUrl: this.verifyUrl(row.verificationCode),
    });

    await this.storage.putObject(path, bytes, 'application/pdf', CERTIFICATE_BUCKET);
    // The column stores the object path, not a URL, and is only a marker
    // that the render has happened: every URL this route hands out is
    // signed and expires, so there is none worth persisting.
    await this.host.tx.certificate.update({ where: { id: row.id }, data: { pdfUrl: path } });
  }

  /**
   * POST /certificates/:id/revoke. The row stays and stays verifiable: an
   * employer holding a revoked document has to be able to find out that it
   * was revoked, which a deleted row cannot tell them.
   */
  async revoke(actor: Actor, certificateId: string, body: RevokeCertificateBody): Promise<Certificate> {
    return this.host.run(async () => {
      const row = await this.loadActive(certificateId);
      const revoked = await this.revokeRow(actor, row, body.reason);

      await this.audit.record({
        action: 'certificate.revoked',
        entityType: 'Certificate',
        entityId: row.id,
        outcome: 'SUCCESS',
        reason: body.reason,
        actorUserId: actor.id,
        before: { status: 'ACTIVE' },
        after: { status: 'REVOKED' },
      });

      return toCertificate(revoked);
    });
  }

  /**
   * The certificate side of an attendance correction that records someone
   * as absent. Not a route: AttendanceService calls it inside its own
   * transaction, so the revocation and the correction commit together or
   * neither does.
   *
   * A registration with no active certificate is the ordinary case, not an
   * error: most corrections happen long before anything is issued.
   */
  async revokeForRegistration(actor: Actor, registrationId: string, reason: string): Promise<boolean> {
    return this.host.run(async () => {
      const row = await this.host.tx.certificate.findFirst({
        where: { registrationId, status: 'ACTIVE' },
      });
      if (!row) return false;

      await this.revokeRow(actor, row, reason);
      await this.audit.record({
        action: 'certificate.revoked',
        entityType: 'Certificate',
        entityId: row.id,
        outcome: 'SUCCESS',
        reason,
        actorUserId: actor.id,
        before: { status: 'ACTIVE' },
        after: { status: 'REVOKED', registrationId },
      });
      return true;
    });
  }

  /**
   * POST /certificates/:id/reissue. A name correction after issuance: the
   * old row goes REVOKED and a fresh ACTIVE one is inserted with new
   * snapshots, in one transaction. Both remain verifiable (spec 7.6).
   */
  async reissue(actor: Actor, certificateId: string, body: ReissueCertificateBody): Promise<Certificate> {
    // The retry is OUTSIDE the transaction, and has to be: Postgres aborts a
    // transaction on a constraint violation, so a loop inside one would only
    // reach a connection refusing every further statement. Each attempt is a
    // fresh transaction, so a retried reissue never leaves the old row
    // revoked with no replacement.
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await this.reissueTx(actor, certificateId, body);
      } catch (e) {
        if (attempt >= INSERT_ATTEMPTS || !isCodeCollision(e)) throw e;
      }
    }
  }

  private async reissueTx(
    actor: Actor,
    certificateId: string,
    body: ReissueCertificateBody,
  ): Promise<Certificate> {
    return this.host.run(async () => {
      const old = await this.loadActive(certificateId);
      // The partial unique index allows exactly one ACTIVE row per
      // registration, so the revoke has to land before the insert.
      await this.revokeRow(actor, old, body.reason);

      const event = await this.host.tx.event.findUniqueOrThrow({
        where: { id: old.eventId },
        select: EVENT_FOR_ISSUE,
      });
      const user = await this.host.tx.user.findUniqueOrThrow({
        where: { id: old.userId },
        select: { fullName: true },
      });

      const fresh = await this.host.tx.certificate.create({
        data: this.newRow(event, old.registrationId, old.userId, user.fullName),
      });

      // Both halves of spec 7.7's trigger fire on a reissue. `revokeRow`
      // already told the holder their document was revoked; without this the
      // inbox says only that, which during a name correction is the opposite
      // of what happened.
      await this.notifications.record({
        userId: fresh.userId,
        type: 'certificate.issued',
        subject: fresh.id,
        payload: {
          certificateId: fresh.id,
          eventId: fresh.eventId,
          eventTitle: fresh.eventTitleSnapshot,
          serialNumber: fresh.serialNumber,
        },
      });

      await this.audit.record({
        action: 'certificate.reissued',
        entityType: 'Certificate',
        entityId: fresh.id,
        outcome: 'SUCCESS',
        reason: body.reason,
        actorUserId: actor.id,
        before: { certificateId: old.id, serialNumber: old.serialNumber, status: 'REVOKED' },
        after: { certificateId: fresh.id, serialNumber: fresh.serialNumber, status: 'ACTIVE' },
      });

      return toCertificate(fresh);
    });
  }

  /**
   * GET /verify/{code}. Public and unauthenticated.
   *
   * The protection here is the code's entropy, not the response shape: this
   * DOES answer a miss with a 404, sooner than it answers a hit, so the
   * route is distinguishable. That is acceptable because there is nothing
   * to enumerate at 128 bits of crypto.randomBytes, not because the answers
   * look alike.
   *
   * What the shape is doing instead is limiting disclosure on a HIT: the
   * six fields of spec 7.6 and nothing else, revoked rows included, so
   * holding a valid code buys the holder no more than the document already
   * told them.
   */
  async verify(code: string): Promise<Verification> {
    const row = await this.host.tx.certificate.findUnique({ where: { verificationCode: code } });
    if (!row) throw new NotFoundError('No certificate matches that code.');

    return {
      status: row.status,
      holderName: row.holderNameSnapshot,
      eventTitle: row.eventTitleSnapshot,
      clubName: row.clubNameSnapshot,
      issuedAt: row.issuedAt.toISOString(),
      revokedAt: row.revokedAt?.toISOString() ?? null,
    };
  }

  private async loadActive(certificateId: string): Promise<CertificateRow> {
    const row = await this.host.tx.certificate.findUnique({ where: { id: certificateId } });
    if (!row) throw new NotFoundError('No such certificate.');
    if (row.status !== 'ACTIVE') throw new UnprocessableError('That certificate is already revoked.');
    return row;
  }

  /**
   * Every revocation goes through here (the Admin route, the attendance
   * correction, and the reissue), so spec 7.7's certificate-revoked
   * notification is written once, in the caller's transaction, rather than
   * at three call sites one of which would eventually be forgotten.
   */
  private async revokeRow(actor: Actor, row: CertificateRow, reason: string): Promise<CertificateRow> {
    const revoked = await this.host.tx.certificate.update({
      where: { id: row.id },
      data: {
        status: 'REVOKED',
        revokedAt: new Date(),
        revokedById: actor.id,
        revokedReason: reason,
      },
    });

    await this.notifications.record({
      userId: row.userId,
      type: 'certificate.revoked',
      subject: row.id,
      payload: {
        certificateId: row.id,
        eventId: row.eventId,
        eventTitle: row.eventTitleSnapshot,
        serialNumber: row.serialNumber,
        reason,
      },
    });

    return revoked;
  }

  private verifyUrl(code: string): string {
    return `${this.webOrigin}/verify/${code}`;
  }
}
