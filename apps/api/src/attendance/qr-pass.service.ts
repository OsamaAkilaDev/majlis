import { Injectable } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- value import: Nest DI resolves this from design:paramtypes.
import { ConfigService } from '@nestjs/config';
import type { QrPass } from '@majlis/contracts';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- value import: see above.
import { AuditService } from '../audit/audit.service';
import { violatedConstraintName } from '../common/prisma-constraint';
import type { Env } from '../config/env.schema';
import { Prisma, type QrPass as QrPassRow } from '../generated/prisma/client';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- value import: see above.
import { TransactionHost } from '../prisma/transaction.host';
import { signPass } from './qr-token';

/**
 * The one persistent identity pass per user of spec 7.5.
 *
 * The signing key is read once, here, and held in a private field. It is
 * never returned, never logged, and never written to an audit row — and
 * neither is the token, which is derived on every read rather than stored:
 * the database holds only `tokenVersion`, which the signature commits to.
 */
@Injectable()
export class QrPassService {
  private readonly secret: string;

  constructor(
    private readonly host: TransactionHost,
    private readonly audit: AuditService,
    config: ConfigService<Env, true>,
  ) {
    this.secret = config.get('QR_SIGNING_SECRET', { infer: true });
  }

  /**
   * GET /me/qr-pass. Creates the row on first call, so a student never has
   * to be told to go and generate one.
   */
  async mine(userId: string): Promise<QrPass> {
    const existing = await this.host.tx.qrPass.findUnique({ where: { userId } });
    return this.present(existing ?? (await this.create(userId)));
  }

  /**
   * `qr_pass.user_id` is unique, and the first call from a freshly opened
   * app races itself — two tabs, or a retry. The loser re-reads the winner's
   * row instead of failing: both callers want the same pass, and there is
   * only ever one.
   */
  private async create(userId: string): Promise<QrPassRow> {
    try {
      return await this.host.tx.qrPass.create({ data: { userId } });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002' &&
        violatedConstraintName(e.meta).includes('qr_pass_user_id')
      ) {
        return this.host.tx.qrPass.findUniqueOrThrow({ where: { userId } });
      }
      throw e;
    }
  }

  /**
   * POST /me/qr-pass/rotate. Bumping the version is what kills every
   * previously issued image: the version is inside the signed payload and
   * every scan re-checks it against the row.
   */
  async rotate(userId: string): Promise<QrPass> {
    return this.host.run(async () => {
      const before = await this.host.tx.qrPass.findUnique({ where: { userId } });
      const now = new Date();

      // `issuedAt` moves with the rotation because it is what the response
      // and the token both mean by "when this pass was issued";
      // `lastRotatedAt` is what distinguishes a rotation from a first issue.
      const row = await this.host.tx.qrPass.upsert({
        where: { userId },
        create: { userId },
        update: { tokenVersion: { increment: 1 }, issuedAt: now, lastRotatedAt: now },
      });

      // Versions only. A raw token never reaches an audit row (spec 5.1).
      await this.audit.record({
        action: 'qr_pass.rotated',
        entityType: 'QrPass',
        entityId: row.id,
        outcome: 'SUCCESS',
        actorUserId: userId,
        ...(before ? { before: { tokenVersion: before.tokenVersion } } : {}),
        after: { tokenVersion: row.tokenVersion },
      });

      return this.present(row);
    });
  }

  private present(row: QrPassRow): QrPass {
    return {
      token: signPass(
        { userId: row.userId, tokenVersion: row.tokenVersion, issuedAt: row.issuedAt },
        this.secret,
      ),
      tokenVersion: row.tokenVersion,
      issuedAt: row.issuedAt.toISOString(),
    };
  }
}
