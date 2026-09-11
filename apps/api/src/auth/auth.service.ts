import { Injectable } from '@nestjs/common';
import type { LoginBody, SessionUser, SignupBody } from '@majlis/contracts';
import { Algorithm, hash, verify, type Options } from '@node-rs/argon2';
import { v7 as uuidv7 } from 'uuid';
import { ConflictError, ForbiddenError, UnauthorizedError } from '../common/problem/domain-error';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- must stay a value import: Nest's constructor DI resolves this provider from the emitted `design:paramtypes` metadata, which needs a real runtime reference.
import { RequestContext } from '../common/request-context';
import { Prisma, type User } from '../generated/prisma/client';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- must stay a value import: same reason as RequestContext above.
import { TransactionHost } from '../prisma/transaction.host';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- must stay a value import: same reason as RequestContext above.
import { TokensService } from './tokens.service';

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
   * Both signup and login begin a new family; Task 10's rotation is what
   * grows one from here.
   */
  private async issueSession(user: User): Promise<AuthResult> {
    const accessToken = await this.tokens.signAccessToken(user.id);
    const { raw, hash: tokenHash } = this.tokens.mintRefreshToken();
    const facts = this.context.current;

    await this.host.tx.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash,
        familyId: uuidv7(),
        expiresAt: await this.tokens.refreshTokenExpiresAt(),
        userAgent: facts?.userAgent ?? null,
        ip: facts?.ip ?? null,
      },
    });

    return { user: await this.buildSessionUser(user), accessToken, refreshToken: raw };
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
