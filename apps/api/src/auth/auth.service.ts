import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ADMIN_ALREADY_EXISTS,
  type BootstrapStatus,
  type ForgotPasswordBody,
  type LoginBody,
  type ResetPasswordBody,
  type ResetPasswordPreview,
  type ResetPasswordPreviewQuery,
  type SessionUser,
  type SignupBody,
} from '@majlis/contracts';
import { Algorithm, hash, verify, type Options } from '@node-rs/argon2';
import { v7 as uuidv7 } from 'uuid';
import { AuditService } from '../audit/audit.service';
import { ConflictError, ForbiddenError, UnauthorizedError } from '../common/problem/domain-error';
import { RequestContext } from '../common/request-context';
import { Prisma, type User } from '../generated/prisma/client';
import { TransactionHost } from '../prisma/transaction.host';
import { TokensService } from './tokens.service';
import { NotificationService } from '../notifications/notification.service';
import type { Env } from '../config/env.schema';

/** A reset link is a bearer credential sitting in an inbox: long enough to
 *  walk to a laptop, short enough that a mailbox read later is worthless. */
export const PASSWORD_RESET_TTL_MINUTES = 30;

/** Expired, used, unknown and suspended all answer this exact string:
 *  distinguishing them tells a caller which half of a guess was right. */
export const RESET_LINK_INVALID = 'That password reset link is no longer valid.';

/**
 * Every refresh failure throws this exact message, so a caller cannot probe
 * which sessions are real. Exported so AuthController's missing-cookie check
 * uses the same literal rather than a second copy that drifts.
 */
export const SESSION_EXPIRED = 'Session expired.';

/**
 * An advisory lock, not the `SELECT ... FOR UPDATE` every other serialised
 * write here uses, because the guard's whole premise is that no admin row
 * exists and an empty result set locks nothing: two concurrent requests would
 * both count zero and both insert. This is the one thing Postgres offers that
 * serialises on the ABSENCE of a row. Transaction-scoped, so a failed
 * bootstrap cannot wedge the endpoint.
 */
const BOOTSTRAP_LOCK_KEY = 8_273_645_521;

/**
 * OWASP's current minimum for argon2id. Exported so real hashing, the dummy
 * hash below and the seed share one set of parameters: the dummy must cost
 * the same ~100ms as a real hash or the timing oracle it closes reopens.
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
  /** PUBLIC_WEB_ORIGIN, trailing slash stripped. Where a reset link points. */
  private readonly webOrigin: string;

  /**
   * Verified against on every login with no matching user row. Without it,
   * "no user, return immediately" and "user found, spend ~100ms hashing" are
   * separable over a few timed requests: an account-existence oracle that an
   * identical response body cannot fix, the gap being before any body exists.
   *
   * Not a secret. It hashes a throwaway value and guards nothing.
   */
  private static readonly DUMMY_HASH =
    '$argon2id$v=19$m=19456,t=2,p=1$GN9bchqBHn2ULEyDayXtaA$zLq1pol3Oya16hlWQFjRnoaPrXLIdDjj7dSf5ht/stU';

  constructor(
    private readonly host: TransactionHost,
    private readonly tokens: TokensService,
    private readonly context: RequestContext,
    private readonly audit: AuditService,
    private readonly notifications: NotificationService,
    config: ConfigService<Env, true>,
  ) {
    this.webOrigin = config.get('PUBLIC_WEB_ORIGIN', { infer: true }).replace(/\/+$/, '');
  }

  /** Already normalised by `signupBodySchema`, which shares `emailSchema`
   *  with login's lookup so the two directions cannot drift. */
  async signup(input: SignupBody): Promise<AuthResult> {
    const passwordHash = await hash(input.password, ARGON2_OPTIONS);

    return this.host.run(async () => {
      let user: User;
      try {
        user = await this.host.tx.user.create({
          data: { email: input.email, passwordHash, fullName: input.fullName },
        });
      } catch (e) {
        // A lost race on the unique email index is expected, not a fault.
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
          throw new ConflictError('An account with this email already exists.');
        }
        throw e;
      }
      return this.issueSession(user);
    });
  }

  /** The only unauthenticated route reporting anything about the account
   *  table: one boolean, nothing else. */
  async bootstrapStatus(): Promise<BootstrapStatus> {
    return { needsAdmin: !(await this.adminExists()) };
  }

  /**
   * The only thing that can produce the FIRST admin: `PATCH /users/{id}`
   * writes `platformRole` but needs `user:edit`, so it multiplies admins and
   * cannot mint one, and the seed is development-only.
   *
   * The guard reads the database, not a flag this endpoint sets, so an admin
   * created by any other means closes it just as firmly.
   *
   * DELIBERATELY OPEN: whoever reaches a deployment with no admin can claim
   * it. Accepted trade (2026-09-15, spec 3); the window shuts on first use,
   * so claim it immediately after a deploy.
   */
  async bootstrapAdmin(input: SignupBody): Promise<AuthResult> {
    // Hashed before the transaction opens: ~100ms of argon2 has no business
    // holding a pooled connection, and here it would hold the lock too.
    const passwordHash = await hash(input.password, ARGON2_OPTIONS);

    return this.host.run(async () => {
      await this.host.tx.$executeRaw`SELECT pg_advisory_xact_lock(${BOOTSTRAP_LOCK_KEY}::bigint)`;

      if (await this.adminExists()) throw new ConflictError(ADMIN_ALREADY_EXISTS);

      let user: User;
      try {
        user = await this.host.tx.user.create({
          data: {
            email: input.email,
            passwordHash,
            fullName: input.fullName,
            platformRole: 'ADMIN',
          },
        });
      } catch (e) {
        // Reachable when the address already belongs to a student who signed
        // up before anyone claimed the admin account.
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
          throw new ConflictError('An account with this email already exists.');
        }
        throw e;
      }

      // No actorUserId: nobody was signed in to do this, which is what the
      // nullable actor column is for. Same transaction as the insert, so
      // there is no committed admin without its audit row.
      await this.audit.record({
        action: 'user.admin_bootstrapped',
        entityType: 'User',
        entityId: user.id,
        outcome: 'SUCCESS',
        after: { email: user.email, fullName: user.fullName, platformRole: user.platformRole },
      });

      return this.issueSession(user);
    });
  }

  /** Whether the platform has an admin. The bootstrap guard, both halves. */
  private async adminExists(): Promise<boolean> {
    return (await this.host.tx.user.count({ where: { platformRole: 'ADMIN' } })) > 0;
  }

  async login(input: LoginBody): Promise<AuthResult> {
    // Outside any transaction: wrapping this method in host.run pinned a
    // pooled connection idle for the whole CPU-bound verify, the first thing
    // to fall over under a login burst. Only issueSession needs one.
    const user = await this.host.tx.user.findUnique({ where: { email: input.email } });

    // Unconditional, even with no user found: verifying against DUMMY_HASH
    // rather than short-circuiting is what keeps "no such account" and
    // "wrong password" costing the same ~100ms.
    const ok = await verify(user?.passwordHash ?? AuthService.DUMMY_HASH, input.password);

    if (!user || !ok) throw new UnauthorizedError('Email or password is incorrect.');

    // Only after the password is proven: the one deliberate exception to
    // enumeration resistance, leaking account state to someone who already
    // knows it. A wrong password on a suspended account still falls through
    // the branch above, indistinguishable from an unknown email.
    if (user.status !== 'ACTIVE') throw new ForbiddenError('This account is suspended.');

    return this.host.run(() => this.issueSession(user));
  }

  /** Starts a brand-new refresh-token family. Signup and login both begin
   *  one; refresh grows it. */
  private async issueSession(user: User): Promise<AuthResult> {
    const accessToken = await this.tokens.signAccessToken(user.id);
    const { raw } = await this.mintRefreshTokenRow(user.id, uuidv7());
    return { user: await this.buildSessionUser(user), accessToken, refreshToken: raw };
  }

  /** Shared by issueSession and refresh, so there is exactly one place a raw
   *  token is generated or a row created. */
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
   * Exchanges a live refresh token for a fresh access token. The token is
   * not rotated: it stays valid until revoked (logout, suspension) or until
   * its 30 days run out. Revocation, not rotation, is what ends a session.
   *
   * Every failure reports the same UnauthorizedError, so expiry, an unknown
   * hash and a suspended user are indistinguishable to the caller.
   */
  async refresh(raw: string): Promise<AuthResult> {
    const hash = this.tokens.hashRefreshToken(raw);
    const row = await this.host.tx.refreshToken.findUnique({ where: { tokenHash: hash } });
    if (!row || row.revokedAt || row.expiresAt <= new Date()) {
      throw new UnauthorizedError(SESSION_EXPIRED);
    }

    // Reloaded every refresh, so a suspension takes effect here too.
    const user = await this.host.tx.user.findUnique({ where: { id: row.userId } });
    if (!user || user.status !== 'ACTIVE') throw new UnauthorizedError(SESSION_EXPIRED);

    return {
      user: await this.buildSessionUser(user),
      accessToken: await this.tokens.signAccessToken(user.id),
      refreshToken: raw,
    };
  }

  /**
   * Revokes the whole family, not one row, and succeeds whatever it finds:
   * no cookie, unknown token, already revoked. A user who cannot log out is
   * worse than a redundant no-op.
   */
  async logout(raw: string | undefined): Promise<void> {
    if (!raw) return;
    const hash = this.tokens.hashRefreshToken(raw);

    await this.host.run(async () => {
      const row = await this.host.tx.refreshToken.findUnique({ where: { tokenHash: hash } });
      if (!row) return;
      const now = new Date();
      await this.host.tx.refreshToken.updateMany({
        where: { familyId: row.familyId, revokedAt: null },
        data: { revokedAt: now },
      });
      // Revoking the family only ends RENEWAL; the access token in the cookie
      // is a stateless 15-minute JWT and outlived logout without this. Same
      // transaction as the revocation, so a logout cannot half-happen.
      //
      // Account-wide, so signing out on one device signs out every device.
      // That is the behaviour, not an accident: narrowing it would need a
      // per-family stamp the access token could be checked against.
      await this.host.tx.user.update({
        where: { id: row.userId },
        data: { sessionsInvalidatedAt: now },
      });
    });
  }

  /**
   * Always succeeds with the same empty answer: unknown address, suspended
   * account and real one must be indistinguishable, or this is an
   * account-existence oracle.
   *
   * The raw token exists on this stack and nowhere else. The row stores only
   * its sha256, and the notification records only THAT a reset was requested.
   *
   * The one notification delivered inline rather than by the sweep: a sweep
   * would need the link in `notification.payload`, and a live reset URL in a
   * JSONB column gives back exactly what hashing the token was for.
   */
  async forgotPassword(input: ForgotPasswordBody): Promise<void> {
    const user = await this.host.tx.user.findUnique({ where: { email: input.email } });
    if (!user || user.status !== 'ACTIVE') return;

    const { raw, hash: tokenHash } = this.tokens.mintOpaqueToken();
    const expiresAt = new Date(Date.now() + PASSWORD_RESET_TTL_MINUTES * 60 * 1000);

    // Before the transaction: the outcome is written onto the row, so it is
    // never PENDING and the sweep cannot pick up a reset it has no link for.
    // A send whose transaction then fails leaves a link that reads as expired.
    const delivered = await this.notifications.deliverNow({
      type: 'auth.password_reset',
      // This payload is never any row's payload.
      payload: {
        resetUrl: `${this.webOrigin}/reset-password?token=${raw}`,
        expiresInMinutes: PASSWORD_RESET_TTL_MINUTES,
      },
      recipientEmail: user.email,
      recipientName: user.fullName,
    });

    await this.host.run(async () => {
      const token = await this.host.tx.passwordResetToken.create({
        data: { userId: user.id, tokenHash, expiresAt },
      });

      await this.notifications.record({
        userId: user.id,
        type: 'auth.password_reset',
        // The token row, not the user: a second request must record a second
        // notification rather than be absorbed as a repeat of the first.
        subject: token.id,
        // No token and no URL: that a reset was requested, and nothing else.
        payload: { expiresInMinutes: PASSWORD_RESET_TTL_MINUTES },
        delivered,
      });

      // No actorUserId: whoever typed the address has not proven they are the
      // account holder, and recording them would put an unverified claim in
      // the trail.
      await this.audit.record({
        action: 'auth.password_reset_requested',
        entityType: 'User',
        entityId: user.id,
        outcome: 'SUCCESS',
      });
    });
  }

  /**
   * Read-only by design. It REPEATS resetPassword's predicate rather than
   * sharing a lookup, because the two must not converge: this may never write
   * `usedAt`, and a shared helper that grew a write would spend the token on
   * page load and break every reset silently.
   *
   * Identical in every other respect on purpose, so a link this accepts is
   * one the POST accepts too.
   */
  async previewReset(query: ResetPasswordPreviewQuery): Promise<ResetPasswordPreview> {
    const tokenHash = this.tokens.hashOpaqueToken(query.token);
    const row = await this.host.tx.passwordResetToken.findFirst({
      where: { tokenHash, usedAt: null, expiresAt: { gt: new Date() } },
      select: { user: { select: { email: true, status: true } } },
    });
    // Suspended answers exactly like expired, as it does on the POST.
    if (!row || row.user.status !== 'ACTIVE') throw new UnauthorizedError(RESET_LINK_INVALID);
    return { email: row.user.email };
  }

  /**
   * POST /auth/reset-password. Single use, enforced by a conditional UPDATE
   * rather than a read-then-write: two requests carrying the same token race
   * on the same row, and only the one whose UPDATE matched proceeds.
   *
   * Revoking every refresh token in the same transaction is the point. A
   * reset that leaves the account's other sessions able to renew themselves
   * for thirty days is not a reset.
   */
  async resetPassword(input: ResetPasswordBody): Promise<void> {
    const tokenHash = this.tokens.hashOpaqueToken(input.token);
    // Outside the transaction, like signup's: ~100ms of argon2 must not hold
    // a pooled connection open.
    const passwordHash = await hash(input.password, ARGON2_OPTIONS);

    await this.host.run(async () => {
      const now = new Date();
      const { count } = await this.host.tx.passwordResetToken.updateMany({
        where: { tokenHash, usedAt: null, expiresAt: { gt: now } },
        data: { usedAt: now },
      });
      if (count === 0) throw new UnauthorizedError(RESET_LINK_INVALID);

      const row = await this.host.tx.passwordResetToken.findUniqueOrThrow({ where: { tokenHash } });
      const user = await this.host.tx.user.findUniqueOrThrow({ where: { id: row.userId } });
      // Suspended after the link was sent. Same answer as an expired token:
      // the caller learns nothing about the account from either.
      if (user.status !== 'ACTIVE') throw new UnauthorizedError(RESET_LINK_INVALID);

      // sessionsInvalidatedAt in the same write, not a second one:
      // SessionGuard refuses every access token issued at or before it, and
      // that is the only thing that ends a session already in progress. A
      // reset that leaves a stolen 15 minute JWT working is not a reset.
      await this.host.tx.user.update({
        where: { id: user.id },
        data: { passwordHash, sessionsInvalidatedAt: now },
      });
      const { count: revoked } = await this.host.tx.refreshToken.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: now },
      });

      await this.audit.record({
        action: 'auth.password_reset',
        entityType: 'User',
        entityId: user.id,
        outcome: 'SUCCESS',
        actorUserId: user.id,
        after: { refreshTokensRevoked: revoked },
      });
    });
  }

  /**
   * GET /auth/me. Rebuilds the exact SessionUser shape signup/login/refresh
   * return, from the actor SessionGuard already loaded fresh for this
   * request. This is deliberately the only endpoint that carries
   * `clubRoles`; `/me` (Task 11's UsersService) returns the editable profile
   * and nothing about authorization.
   */
  async me(user: User): Promise<SessionUser> {
    return this.buildSessionUser(user);
  }

  /**
   * Every auth response's user shape includes the actor's ACTIVE club
   * roles, the same ACTIVE-only filter PermissionsGuard's resolveClubFacts
   * applies (no permission is active until status = 'ACTIVE'), so the
   * student/officer/admin shell can route on login without a second round
   * trip.
   */
  private async buildSessionUser(user: User): Promise<SessionUser> {
    const appointments = await this.host.tx.clubTeamAppointment.findMany({
      where: { userId: user.id, status: 'ACTIVE' },
      select: { clubId: true, role: true, club: { select: { name: true } } },
    });

    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      avatarUrl: user.avatarUrl,
      platformRole: user.platformRole,
      clubRoles: appointments.map((a) => ({
        clubId: a.clubId,
        clubName: a.club.name,
        role: a.role,
      })),
    };
  }
}
