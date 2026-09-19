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

/**
 * Short on purpose. A reset link is a bearer credential sitting in an inbox,
 * and thirty minutes is long enough to walk to a laptop and short enough
 * that a mailbox read months later is worthless.
 */
export const PASSWORD_RESET_TTL_MINUTES = 30;

/**
 * Expired, already used, unknown, and belonging to a suspended account all
 * answer with this exact string. Distinguishing them would tell a caller
 * holding a guessed token which half of the guess was right.
 */
export const RESET_LINK_INVALID = 'That password reset link is no longer valid.';

/**
 * Every refresh failure path throws this exact message: expiry, an
 * unknown token, a suspended user, and (in the controller) a missing
 * cookie. The client cannot tell which case occurred, and does not need
 * to: distinguishing them would only help an attacker probe which sessions
 * are real. Exported so AuthController's missing-cookie check uses the same
 * literal rather than a second copy that could drift from this one.
 */
export const SESSION_EXPIRED = 'Session expired.';

/**
 * Advisory lock key for the create-first-admin path, an arbitrary constant
 * that means nothing except "whoever holds it is bootstrapping".
 *
 * Every other serialised write in this codebase locks the row it is about
 * to change (`SELECT ... FOR UPDATE`, see UsersService.updateStatus). That
 * is not available here: the whole point of the guard is that no admin row
 * exists yet, and an empty result set locks nothing. Two concurrent
 * requests would both count zero admins, both pass the guard, and both
 * insert — handing the deployment a second platform owner. A
 * transaction-scoped advisory lock is the one thing Postgres offers that
 * serialises on the absence of a row. Released on commit or rollback
 * without an unlock call, so a failed bootstrap cannot wedge the endpoint.
 */
const BOOTSTRAP_LOCK_KEY = 8_273_645_521;

/**
 * OWASP's current minimum for argon2id. Exported so the exact same
 * parameters govern real password hashing, the dummy hash below (which must
 * cost the same ~100ms as a real hash to close the timing oracle it
 * defeats), and Task 12's seed, three call sites that must never drift out
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
  /** PUBLIC_WEB_ORIGIN, trailing slash stripped. Where a reset link points. */
  private readonly webOrigin: string;

  /**
   * A fixed argon2id hash of a throwaway string (generated once with
   * ARGON2_OPTIONS, pasted here as a literal), verified against on every
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
    private readonly notifications: NotificationService,
    config: ConfigService<Env, true>,
  ) {
    this.webOrigin = config.get('PUBLIC_WEB_ORIGIN', { infer: true }).replace(/\/+$/, '');
  }

  /**
   * `input.email` was already normalised by `signupBodySchema` at the
   * validation boundary, the same `emailSchema` login's lookup uses, so
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
        // a server fault: reported as a domain conflict, never a 500.
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
          throw new ConflictError('An account with this email already exists.');
        }
        throw e;
      }
      return this.issueSession(user);
    });
  }

  /**
   * GET /auth/bootstrap. Drives the create-admin screen, and is the only
   * unauthenticated route that reports anything about the account table:
   * one boolean, nothing else.
   */
  async bootstrapStatus(): Promise<BootstrapStatus> {
    return { needsAdmin: !(await this.adminExists()) };
  }

  /**
   * POST /auth/bootstrap. Creates the platform's first ADMIN, and only
   * while there is none.
   *
   * This exists because nothing else can produce the FIRST admin. Since
   * 2026-09-17 `PATCH /users/{id}` does write `platformRole`, but only for a
   * caller who already holds `user:edit`, i.e. an admin: it multiplies admins
   * and cannot mint one from nothing. The seed is development-only, so a
   * fresh deployment would otherwise have no reachable path to an admin
   * account and therefore none to a club, since only an admin can create one.
   *
   * The guard reads the database rather than a flag this endpoint sets, so
   * an admin created by any other means (the seed, hand-written SQL)
   * closes the endpoint just as firmly as one created here.
   *
   * Deliberately open: anyone who reaches a deployment that has no admin
   * can claim the account. That is the accepted trade (decided 2026-09-15,
   * see spec §3) and the window closes on first use, so claim it
   * immediately after a deploy rather than leaving it open.
   */
  async bootstrapAdmin(input: SignupBody): Promise<AuthResult> {
    // Hashed before the transaction opens, same reasoning as signup: ~100ms
    // of argon2 has no business holding a pooled connection, and here it
    // would hold the advisory lock along with it.
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
        // Same treatment as signup's lost race on the unique email index:
        // reachable here when the address already belongs to a student who
        // signed up before anyone claimed the admin account.
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
          throw new ConflictError('An account with this email already exists.');
        }
        throw e;
      }

      // No actorUserId: nobody was signed in to do this, and AuditLog's
      // actor column is nullable for exactly this kind of action. The
      // subject is the new admin. Written inside the same transaction as
      // the insert, so there is no committed admin without its audit row.
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
    // Looked up outside any transaction, same reasoning as signup's hash()
    // call: the read plus the ~100ms argon2 verify below have no need of one,
    // and only issueSession (minting a token and persisting the refresh-token
    // row) does. The pre-fix version wrapped this whole method in host.run,
    // pinning a pooled connection idle for the entire CPU-bound verify,
    // the first thing to fall over under a semester-start login burst on a
    // small serverless pool.
    const user = await this.host.tx.user.findUnique({ where: { email: input.email } });

    // Runs unconditionally, even when no user was found, and still outside
    // any transaction. Verifying against DUMMY_HASH instead of
    // short-circuiting is what keeps "no such account" and "wrong password"
    // costing the same ~100ms.
    const ok = await verify(user?.passwordHash ?? AuthService.DUMMY_HASH, input.password);

    if (!user || !ok) throw new UnauthorizedError('Email or password is incorrect.');

    // Reported only once the caller has already proven the password, the
    // one deliberate exception to enumeration resistance (spec: this
    // leaks account state only to someone who already knows it). A wrong
    // password against a suspended account still falls through the branch
    // above, indistinguishable from an unknown email.
    if (user.status !== 'ACTIVE') throw new ForbiddenError('This account is suspended.');

    return this.host.run(() => this.issueSession(user));
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
   * existing family) so both mint through the exact same code: there is
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
   * Revokes the whole family the presented token belongs to (not just the
   * one row) and returns regardless of what it finds: no cookie, an
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
      const now = new Date();
      await this.host.tx.refreshToken.updateMany({
        where: { familyId: row.familyId, revokedAt: null },
        data: { revokedAt: now },
      });
      // Revoking the family ends the ability to RENEW; the access token
      // already in the cookie is a stateless 15 minute JWT and outlived the
      // logout without this. Same mechanism a password reset uses, in the
      // same transaction as the revocation, so a logout cannot half-happen.
      //
      // It is account-wide rather than per family, because the stamp is a
      // single instant on the user, so signing out on one device signs out
      // every device. That is the behaviour, not an accident: the web
      // middleware only renews when the session cookie is ABSENT, and this
      // leaves it present but rejected, so another device lands on /login.
      // Narrowing it to one family would need a per-family stamp the access
      // token could be checked against, and nobody has asked for multi-device
      // sessions to survive a sign-out.
      await this.host.tx.user.update({
        where: { id: row.userId },
        data: { sessionsInvalidatedAt: now },
      });
    });
  }

  /**
   * POST /auth/forgot-password. Always succeeds, and always with the same
   * empty answer: an unknown address, a suspended account and a real one are
   * indistinguishable to the caller, or this endpoint is an
   * account-existence oracle.
   *
   * The raw token exists on this function's stack and nowhere else. It is
   * handed to the channel in memory and the email is composed from it there;
   * the row stores only its sha256, like RefreshToken, and the notification
   * records only THAT a reset was requested.
   *
   * This is the one notification delivered inline rather than by the sweep.
   * A sweep would have to find the link in `notification.payload`, and a
   * live reset URL sitting in a JSONB column gives back exactly what hashing
   * the token was for: one read of that table would yield working links for
   * every pending request, outliving each token's own expiry.
   */
  async forgotPassword(input: ForgotPasswordBody): Promise<void> {
    const user = await this.host.tx.user.findUnique({ where: { email: input.email } });
    if (!user || user.status !== 'ACTIVE') return;

    const { raw, hash: tokenHash } = this.tokens.mintOpaqueToken();
    const expiresAt = new Date(Date.now() + PASSWORD_RESET_TTL_MINUTES * 60 * 1000);

    // Before the transaction, not after it: the outcome is written onto the
    // row, so the row is never PENDING and the sweep can never pick up a
    // password reset it has no link for. A send whose transaction then fails
    // leaves a link that answers exactly like an expired one.
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
        // notification rather than being absorbed as a repeat of the first.
        subject: token.id,
        // No token and no URL. This row records that a reset was requested
        // and when the link stops working, and nothing else.
        payload: { expiresInMinutes: PASSWORD_RESET_TTL_MINUTES },
        delivered,
      });

      // No actorUserId: nobody authenticated here. Whoever typed the address
      // has not proven they are the account holder, and recording them as
      // the actor would put a claim in the trail that nothing verified.
      await this.audit.record({
        action: 'auth.password_reset_requested',
        entityType: 'User',
        entityId: user.id,
        outcome: 'SUCCESS',
      });
    });
  }

  /**
   * GET /auth/reset-password. Names the account a link belongs to, so the
   * screen can show whose password it is about to change without ever
   * rendering the token.
   *
   * Read-only by design. It repeats resetPassword's predicate rather than
   * sharing a lookup with it, because the two must not converge: this one
   * may never write `usedAt`, and a shared helper that grew a write would
   * spend the token on page load and break every reset silently.
   *
   * The predicate itself is the same in every other respect, and that is the
   * point: a link this answers for is a link the POST will accept, so the
   * user is never told a link is good and then refused after typing a
   * password twice.
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
