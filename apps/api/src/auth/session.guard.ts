import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- must stay a value import: Nest's constructor DI resolves this provider from the emitted `design:paramtypes` metadata, which needs a real runtime reference.
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { UnauthorizedError } from '../common/problem/domain-error';
import type { User } from '../generated/prisma/client';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- must stay a value import: Nest's constructor DI resolves this provider from the emitted `design:paramtypes` metadata, which needs a real runtime reference.
import { TransactionHost } from '../prisma/transaction.host';
import { SESSION_COOKIE } from './cookies';
import { IS_PUBLIC_KEY } from './public.decorator';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- must stay a value import: Nest's constructor DI resolves this provider from the emitted `design:paramtypes` metadata, which needs a real runtime reference.
import { TokensService } from './tokens.service';

declare module 'express' {
  interface Request {
    actor?: User;
  }
}

/**
 * Whether this access token was minted at or before the instant the account's
 * sessions were last invalidated, and so must be refused.
 *
 * Revoking refresh tokens ends the ability to RENEW a session; it cannot
 * touch an access token already issued, which is a stateless 15-minute JWT
 * carrying only `{ sub, iat, exp }`. This comparison is what actually ends a
 * session in progress. Both the paths that need that stamp it: a password
 * reset, because the credential may already be in someone else's hands, and
 * a logout, which otherwise left the access token live for its remaining 15
 * minutes.
 *
 * `iat` is UNIX SECONDS and the column is milliseconds, so the column is
 * floored to seconds and the comparison is `<=`, not `<`. A token minted in
 * the same second as the stamp is indistinguishable from one minted just
 * before it, and must be treated as the older of the two or there is a
 * one-second hole. The cost is that a token minted within the same second
 * AFTER a stamp is also refused; the holder signs in again, one second later
 * at worst.
 *
 * Exported so the comparison can be exercised directly, without minting a
 * JWT and waiting a second for its `iat` to move.
 */
export function sessionsInvalidatedSince(sessionsInvalidatedAt: Date | null, issuedAt: number): boolean {
  if (!sessionsInvalidatedAt) return false;
  return issuedAt <= Math.floor(sessionsInvalidatedAt.getTime() / 1000);
}

/**
 * Registered globally as APP_GUARD (see AuthModule) so every route is
 * protected unless explicitly marked @Public(). Runs before PermissionsGuard
 * (Task 8), which reads `req.actor` set here — that guard must be registered
 * immediately after this one, never before.
 */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokensService,
    private readonly host: TransactionHost,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest<Request>();
    const token = req.cookies?.[SESSION_COOKIE] as string | undefined;
    if (!token) throw new UnauthorizedError('Not signed in.');

    const { userId, issuedAt } = await this.tokens.verifyAccessToken(token);

    // Loaded on EVERY request. This is what makes suspension and appointment
    // loss take effect on the next request rather than at token expiry.
    // Do not cache it. Do not move any of it into the token.
    const user = await this.host.tx.user.findUnique({ where: { id: userId } });
    // Same generic message as a missing cookie — the specific "account
    // suspended" wording belongs only on the login response (Task 9), where
    // the caller has already proven the password.
    if (!user || user.status !== 'ACTIVE') throw new UnauthorizedError('Not signed in.');
    if (sessionsInvalidatedSince(user.sessionsInvalidatedAt, issuedAt)) {
      throw new UnauthorizedError('Not signed in.');
    }

    req.actor = user;
    return true;
  }
}
