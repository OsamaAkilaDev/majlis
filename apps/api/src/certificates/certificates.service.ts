import { Injectable } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- value import: Nest DI resolves this from design:paramtypes.
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
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- value import: see above.
import { AuditService } from '../audit/audit.service';
import type { PlatformRole } from '../auth/permissions';
import { cursorArgs, cursorPage } from '../common/cursor-page';
import { violatedConstraintName } from '../common/prisma-constraint';
import { ForbiddenError, NotFoundError, UnprocessableError } from '../common/problem/domain-error';
import type { Env } from '../config/env.schema';
import { assertTransition } from '../events/event-status';
import { Prisma, type Certificate as CertificateRow } from '../generated/prisma/client';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- value import: see above.
import { TransactionHost } from '../prisma/transaction.host';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- value import: see above.
import { StorageService } from '../storage/storage.service';
import { certificatePdfPath } from '../storage/image-kinds';
import { serialNumber, verificationCode } from './certificate-codes';
import { renderCertificate } from './certificate-pdf';

const HOUR_MS = 60 * 60 * 1000;

/**
 * Who is eligible, per the event's `attendance_policy` (spec 7.6). The one
 * policy that exists today is CHECK_IN_ONLY; the others are a later additive
 * stage and get their own entries here rather than an `if`.
 */
const ELIGIBLE = {
  CHECK_IN_ONLY: ['CHECKED_IN', 'ATTENDED'],
} as const satisfies Record<string, readonly string[]>;

/**
 * A serial or verification code collision is astronomically unlikely and
 * still has to be survivable, so the insert is retried with fresh codes
 * rather than returning a 500. Three attempts is far past the point where a
 * fourth would mean something other than chance.
 */
const INSERT_ATTEMPTS = 3;

/** A sweep that found more than this has a bigger problem than a slow run. */
const ISSUE_SWEEP_LIMIT = 500;

/**
 * Long enough for a browser to follow the URL it was just handed, short
 * enough that one leaked out of a history entry or a referrer header is
 * already dead.
 */
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
 * A collision on one of the two generated codes, which is worth retrying
 * with fresh ones. Deliberately NOT
 * `certificate_one_active_per_registration`: that one means somebody else
 * already issued this registration's certificate, and retrying would loop
 * until the attempts ran out before answering the conflict it always was.
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
  private readonly correctionWindowMs: number;
  private readonly webOrigin: string;

  constructor(
    private readonly host: TransactionHost,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
    config: ConfigService<Env, true>,
  ) {
    this.correctionWindowMs = config.get('ATTENDANCE_CORRECTION_WINDOW_HOURS', { infer: true }) * HOUR_MS;
    this.webOrigin = config.get('PUBLIC_WEB_ORIGIN', { infer: true }).replace(/\/+$/, '');
  }

  /**
   * The lazy path: called after `advance()` on every single-event read and
   * action, and by the sweep per swept row. Silent about an event that is
   * not ready, because most of the events it is called for never will be.
   *
   * This depends on nothing in `events/` beyond the transition function, so
   * `EventsService` can call it without a cycle. There is no queue.
   */
  async issueForEvent(eventId: string): Promise<CertificateIssueResult> {
    const event = await this.host.tx.event.findUnique({
      where: { id: eventId },
      select: EVENT_FOR_ISSUE,
    });
    if (!event || this.notIssuableReason(event)) return { issued: 0, total: 0 };
    return this.issueCore(event);
  }

  /**
   * Every event whose certificates have come due, issued in its own
   * transaction. Called by the lifecycle sweep, and it is the path that
   * actually issues: an event reaches COMPLETED when its check-in window
   * shuts, but cannot issue until the correction window closes 48 hours
   * later, so no status advance is ever also an issuance. The opportunistic
   * path in EventsService only fires if a person happens to open the event
   * after that.
   */
  async issueDue(now = new Date()): Promise<number> {
    const rows = await this.host.tx.event.findMany({
      where: {
        status: 'COMPLETED',
        certificateEnabled: true,
        endsAt: { lt: new Date(now.getTime() - this.correctionWindowMs) },
      },
      select: { id: true },
      take: ISSUE_SWEEP_LIMIT,
    });

    let issued = 0;
    // One transaction per event, like the lifecycle sweep: one unexpected
    // event must not roll back everybody else's certificates.
    for (const row of rows) issued += (await this.issueForEvent(row.id)).issued;
    return issued;
  }

  /**
   * POST /events/:eventId/certificates/issue. Same work, but an Admin who
   * pressed the button is told why nothing happened.
   */
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
   * Why this event cannot issue certificates, or null.
   *
   * An event already CERTIFIED is NOT a refusal: issuance is idempotent
   * (spec 7.6), and a second press of the button has to be a no-op rather
   * than an error. `issueCore` finds nothing left to do and says so.
   *
   * The clock gate is `endsAt` plus the correction window, not COMPLETED.
   * Issuing the moment an event completes would reduce spec 7.5's 48 hours
   * for correcting attendance to zero, and §7.6 locks attendance at
   * CERTIFIED, so the two rules only coexist if issuance waits.
   */
  private notIssuableReason(event: IssuableEvent): string | null {
    if (!event.certificateEnabled) return 'That event does not issue certificates.';
    if (event.status === 'CERTIFIED') return null;
    if (event.status !== 'COMPLETED') return 'That event has not finished yet.';
    if (Date.now() <= event.endsAt.getTime() + this.correctionWindowMs) {
      return 'Certificates are issued once the attendance correction window has closed.';
    }
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
            // The partial unique index is the guarantee; this is what keeps
            // the common second run from relying on it. A NO_SHOW is not in
            // the status filter above and so never reaches here at all.
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

      const total = await this.host.tx.certificate.count({
        where: { eventId: event.id, status: 'ACTIVE' },
      });

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

  /** GET /me/certificates. Self-scoped by `userId`; no permission key. */
  async mine(actor: Actor, query: CertificateListQuery): Promise<CertificatePage> {
    const rows = await this.host.tx.certificate.findMany({
      where: { userId: actor.id },
      ...cursorArgs(query),
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

    if (!row.pdfUrl) {
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

      await this.storage.putObject(path, bytes, 'application/pdf');
      // The column stores the object path, not a URL, and is only a marker
      // that the render has happened: every URL this route hands out is
      // signed and expires, so there is none worth persisting.
      await this.host.tx.certificate.update({ where: { id: row.id }, data: { pdfUrl: path } });
    }

    // Signed, never public. The object path is a pure function of the
    // certificate id and every holder of `registration:read` can list those
    // ids, so a public URL would make the ownership check above decorative.
    return { pdfUrl: await this.storage.createSignedDownloadUrl(path, PDF_URL_TTL_SECONDS) };
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

  private revokeRow(actor: Actor, row: CertificateRow, reason: string): Promise<CertificateRow> {
    return this.host.tx.certificate.update({
      where: { id: row.id },
      data: {
        status: 'REVOKED',
        revokedAt: new Date(),
        revokedById: actor.id,
        revokedReason: reason,
      },
    });
  }

  private verifyUrl(code: string): string {
    return `${this.webOrigin}/verify/${code}`;
  }
}
