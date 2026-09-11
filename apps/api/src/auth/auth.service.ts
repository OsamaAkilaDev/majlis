import { Injectable } from '@nestjs/common';
import type { LoginBody, SessionUser, SignupBody } from '@majlis/contracts';
import { Algorithm, hash, verify, type Options } from '@node-rs/argon2';
import { v7 as uuidv7 } from 'uuid';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- must stay a value import: Nest's constructor DI resolves this provider from the emitted `design:paramtypes` metadata, which needs a real runtime reference.
import { AuditService } from '../audit/audit.service';
import { ConflictError, ForbiddenError, UnauthorizedError } from '../common/problem/domain-error';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- must stay a value import: Nest's constructor DI resolves this provider from the emitted `design:paramtypes` metadata, which needs a real runtime reference.
import { RequestContext } from '../common/request-context';
import { Prisma, type User } from '../generated/prisma/client';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- must stay a value import: same reason as RequestContext above.
import { TransactionHost } from '../prisma/transaction.host';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- must stay a value import: same reason as RequestContext above.
import { TokensService } from './tokens.service';

/**
 * Every refresh failure path — expiry, reuse, an unknown token, a suspended
 * user, and (in the controller) a missing cookie — throws this exact
 * message. The client cannot tell which case occurred, and does not need
 * to: distinguishing them would only help an attacker probe which sessions
 * are real. Exported so AuthController's missing-cookie check uses the same
 * literal rather than a second copy that could drift from this one.
 */
export const SESSION_EXPIRED = 'Session expired.';

/**
 * OWASP's current minimum for argon2id. Exported so the exact same
 * parameters govern real password hashing, the dummy hash below (which must
 * cost the same ~100ms as a real hash to close the timing oracle it
 * defeats), and Task 12's seed — three call sites that must never drift out
 * of step with each other.
 */
export const ARGON2_OPTIONS: Options = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};

export interface AuthResult {
  user: SessionUser;
  accessToken: string;
  refreshToken: string;
}

@Injectable()
export class AuthService {
  /**
   * A fixed argon2id hash of a throwaway string — generated once with
   * ARGON2_OPTIONS, pasted here as a literal — verified against on every
   * login where no matching user row exists.
   *
   * Without it, "no user, return immediately" and "user found, spend ~100ms
   * hashing" are separable over a handful of timed requests: a reliable
   * account-existence oracle that an identical response BODY does not fix,
   * since the timing gap happens before any body is built. Not a secret: it
   * hashes a throwaway value and guards nothing.
   */
  private static readonly DUMMY_HASH =
    '$argon2id$v=19$m=19456,t=2,p=1$GN9bchqBHn2ULEyDayXtaA$zLq1pol3Oya16hlWQFjRnoaPrXLIdDjj7dSf5ht/stU';

  constructor(
    private readonly host: TransactionHost,
    private readonly tokens: TokensService,
    private readonly context: RequestContext,
    private readonly audit: AuditService,
  ) {}

  /**
   * `input.email` was already normalised by `signupBodySchema` at the
   * validation boundary — the same `emailSchema` login's lookup uses, so
   * the two directions can never drift apart (see @majlis/contracts).
   */
  async signup(input: SignupBody): Promise<AuthResult> {
    const passwordHash = await hash(input.password, ARGON2_OPTIONS);

    return this.host.run(async () => {
      let user: User;
      try {
        user = await this.host.tx.user.create({
          data: { email: input.email, passwordHash, fullName: input.fullName },
        });
      } catch (e) {
        // A lost race on the unique email index is an expected outcome, not
        // a server fault — reported as a domain conflict, never a 500.
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
          throw new ConflictError('An account with this email already exists.');
        }
        throw e;
      }
      return this.issueSession(user);
    });
  }

  async login(input: LoginBody): Promise<AuthResult> {
    return this.host.run(async () => {
      const user = await this.host.tx.user.findUnique({ where: { email: input.email } });

      // Runs unconditionally, even when no user was found — verifying
      // against DUMMY_HASH instead of short-circuiting is what keeps "no
      // such account" and "wrong password" costing the same ~100ms.
      const ok = await verify(user?.passwordHash ?? AuthService.DUMMY_HASH, input.password);

      if (!user || !ok) throw new UnauthorizedError('Email or password is incorrect.');

      // Reported only once the caller has already proven the password — the
      // one deliberate exception to enumeration resistance (spec: this
      // leaks account state only to someone who already knows it). A wrong
      // password against a suspended account still falls through the branch
      // above, indistinguishable from an unknown email.
      if (user.status !== 'ACTIVE') throw new ForbiddenError('This account is suspended.');

      return this.issueSession(user);
    });
  }

  /**
   * Mints a fresh access token and starts a brand-new refresh-token family.
   * Both signup and login begin a new family; refresh (below) is what grows
   * one from here.
   */
  private async issueSession(user: User): Promise<AuthResult> {
    const accessToken = await this.tokens.signAccessToken(user.id);
    const { raw } = await this.mintRefreshTokenRow(user.id, uuidv7());
    return { user: await this.buildSessionUser(user), accessToken, refreshToken: raw };
  }

  /**
   * Inserts one refresh_token row and returns its id and raw value. Shared
   * by issueSession (a brand-new family) and refresh (a rotation within an
   * existing family) so both mint through the exact same code — there is
   * only one place a raw token is ever generated or a row ever created.
   */
  private async mintRefreshTokenRow(
    userId: string,
    familyId: string,
  ): Promise<{ id: string; raw: string }> {
    const { raw, hash: tokenHash } = this.tokens.mintRefreshToken();
    const facts = this.context.current;

    const row = await this.host.tx.refreshToken.create({
      data: {
        userId,
        tokenHash,
        familyId,
        expiresAt: await this.tokens.refreshTokenExpiresAt(),
        userAgent: facts?.userAgent ?? null,
        ip: facts?.ip ?? null,
      },
    });
    return { id: row.id, raw };
  }

  /**
   * Rotation with family-wide reuse detection. Presenting a refresh token
   * that was already rotated (or already revoked for any other reason)
   * means one of two things happened: a thief is replaying a stolen token,
   * or the legitimate user is (e.g. a lost race between two tabs). The
   * server cannot tell which, so neither keeps the session — the entire
   * family is revoked, including members minted after the replayed token.
   * That is deliberately harsher than revoking only the presented row or
   * its ancestors, which would leave a thief's later-rotated token alive.
   *
   * Every failure below reports the exact same UnauthorizedError, so expiry,
   * reuse, an unknown token hash, and a suspended user are indistinguishable
   * to the caller.
   *
   * The failure branches return a sentinel from inside host.run rather than
   * throwing there: `host.run` wraps its callback in Prisma's interactive
   * `$transaction`, and Prisma rolls that transaction back the moment the
   * callback throws. Throwing UnauthorizedError from inside the reuse branch
   * would silently undo the very writes reuse detection exists to make — the
   * family-wide revocation and the audit row — before the 401 ever reached
   * the caller. Only the outer, non-transactional call is allowed to throw.
   */
  async refresh(raw: string): Promise<AuthResult> {
    type Outcome = { ok: true; result: AuthResult } | { ok: false };

    const outcome: Outcome = await this.host.run(async () => {
      const hash = this.tokens.hashRefreshToken(raw);

      // Locks the one row this hash can match (token_hash is unique) before
      // any read of it, so a concurrent refresh of the same token serialises
      // on this row rather than both readers seeing it as still-live and
      // both successfully rotating it. Locked via raw SQL, then re-read
      // through Prisma so the rest of this method works with the normal
      // camelCase model rather than hand-mapping columns.
      const locked = await this.host.tx.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "refresh_token" WHERE "token_hash" = ${hash} FOR UPDATE`;
      if (locked.length === 0) return { ok: false };

      const row = await this.host.tx.refreshToken.findUniqueOrThrow({
        where: { id: locked[0]!.id },
      });

      if (row.revokedAt || row.replacedById) {
        // REUSE. Revoking the family is the entire point of rotation — see
        // the doc comment above.
        await this.host.tx.refreshToken.updateMany({
          where: { familyId: row.familyId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        await this.audit.record({
          action: 'auth.refresh.reuse_detected',
          entityType: 'RefreshToken',
          entityId: row.id,
          outcome: 'DENIED',
          actorUserId: row.userId,
          reason: 'A rotated refresh token was presented again.',
        });
        return { ok: false };
      }

      if (row.expiresAt <= new Date()) return { ok: false };

      const user = await this.host.tx.user.findUnique({ where: { id: row.userId } });
      if (!user || user.status !== 'ACTIVE') return { ok: false };

      // Sliding expiry: the successor gets a fresh full TTL from
      // mintRefreshTokenRow rather than inheriting row.expiresAt, so an
      // active session never approaches its original expiry as long as it
      // keeps refreshing.
      const successor = await this.mintRefreshTokenRow(user.id, row.familyId);
      await this.host.tx.refreshToken.update({
        where: { id: row.id },
        data: { revokedAt: new Date(), replacedById: successor.id },
      });

      return {
        ok: true,
        result: {
          user: await this.buildSessionUser(user),
          accessToken: await this.tokens.signAccessToken(user.id),
          refreshToken: successor.raw,
        },
      };
    });

    if (!outcome.ok) throw new UnauthorizedError(SESSION_EXPIRED);
    return outcome.result;
  }

  /**
   * Revokes the whole family the presented token belongs to (not just the
   * one row) and returns regardless of what it finds — no cookie, an
   * unknown token, or one already revoked all succeed identically. A user
   * who cannot log out is a worse outcome than a redundant no-op, and there
   * is nothing sensitive to report by failing here: unlike reuse, presenting
   * your own most-recent token to log out is completely routine.
   */
  async logout(raw: string | undefined): Promise<void> {
    if (!raw) return;
    const hash = this.tokens.hashRefreshToken(raw);

    await this.host.run(async () => {
      const row = await this.host.tx.refreshToken.findUnique({ where: { tokenHash: hash } });
      if (!row) return;
      await this.host.tx.refreshToken.updateMany({
        where: { familyId: row.familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    });
  }

  /**
   * Every auth response's user shape includes the actor's ACTIVE club
   * roles — the same ACTIVE-only filter PermissionsGuard's resolveClubFacts
   * applies (no permission is active until status = 'ACTIVE') — so the
   * student/officer/admin shell can route on login without a second round
   * trip.
   */
  private async buildSessionUser(user: User): Promise<SessionUser> {
    const appointments = await this.host.tx.clubTeamAppointment.findMany({
      where: { userId: user.id, status: 'ACTIVE' },
      select: { clubId: true, role: true },
    });

    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      avatarUrl: user.avatarUrl,
      platformRole: user.platformRole,
      clubRoles: appointments.map((a) => ({ clubId: a.clubId, role: a.role })),
    };
  }
}
