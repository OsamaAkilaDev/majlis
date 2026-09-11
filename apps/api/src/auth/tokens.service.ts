import { createHash, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- must stay a value import: Nest's constructor DI resolves this provider from the emitted `design:paramtypes` metadata, which needs a real runtime reference.
import { ConfigService } from '@nestjs/config';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- must stay a value import: same reason as ConfigService above, this is a constructor-injected provider.
import { JwtService, type JwtSignOptions } from '@nestjs/jwt';
import { UnauthorizedError } from '../common/problem/domain-error';
import type { Env } from '../config/env.schema';

@Injectable()
export class TokensService {
  /**
   * jsonwebtoken's `expiresIn` type is a template-literal `StringValue`
   * ("15m", "30d", ...) narrower than the plain `string` the env schema
   * validates — the value itself (any string `ms()` parses) is already
   * checked at boot, so this cast just aligns the two types.
   */
  private readonly accessTtl: JwtSignOptions['expiresIn'];

  constructor(
    private readonly jwt: JwtService,
    config: ConfigService<Env, true>,
  ) {
    this.accessTtl = config.get('ACCESS_TOKEN_TTL', { infer: true }) as JwtSignOptions['expiresIn'];
  }

  /**
   * The payload is `{ sub, iat, exp }` and nothing else — no role, no club
   * IDs, no permissions. Spec §6.2 promises that losing an appointment takes
   * effect on the very next request because permissions are re-derived per
   * request and never cached in the session; a role claim here would make
   * that false for up to the access token's TTL, and would make it false
   * invisibly, since every test written on the assumption that the role
   * lives in the token would still pass.
   */
  async signAccessToken(userId: string): Promise<string> {
    return this.jwt.signAsync({}, { subject: userId, expiresIn: this.accessTtl });
  }

  /** Returns the `sub` claim, or throws UnauthorizedError for any failure. */
  async verifyAccessToken(token: string): Promise<string> {
    try {
      const claims = await this.jwt.verifyAsync<{ sub: string }>(token);
      return claims.sub;
    } catch {
      throw new UnauthorizedError('Invalid or expired access token');
    }
  }

  /**
   * Refresh tokens are SHA-256, not argon2id. A 256-bit random string has no
   * structure to guess and no dictionary to attack, so argon2id's work
   * factor — correct for a human-chosen password — buys nothing here and
   * would add ~100ms to every refresh. Passwords stay argon2id.
   */
  mintRefreshToken(): { raw: string; hash: string } {
    const raw = randomBytes(32).toString('base64url');
    return { raw, hash: this.hashRefreshToken(raw) };
  }

  hashRefreshToken(raw: string): string {
    return createHash('sha256').update(raw).digest('hex');
  }
}
