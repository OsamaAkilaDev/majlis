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
   * ("15m", "30d", ...) narrower than the plain `string` type the env schema
   * exposes here — `envSchema` validates the value's actual format (against
   * the grammar `ms()` accepts) at boot, so this cast just aligns the two
   * TypeScript types; it is not doing any of the real validation.
   */
  private readonly accessTtl: JwtSignOptions['expiresIn'];
  private readonly refreshTtl: JwtSignOptions['expiresIn'];

  constructor(
    private readonly jwt: JwtService,
    config: ConfigService<Env, true>,
  ) {
    this.accessTtl = config.get('ACCESS_TOKEN_TTL', { infer: true }) as JwtSignOptions['expiresIn'];
    this.refreshTtl = config.get('REFRESH_TOKEN_TTL', { infer: true }) as JwtSignOptions['expiresIn'];
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
    return this.mintOpaqueToken();
  }

  hashRefreshToken(raw: string): string {
    return this.hashOpaqueToken(raw);
  }

  /**
   * 256 bits of randomness and its sha256. Shared by refresh tokens and
   * password reset tokens, which are the same credential shape: a long
   * random string the server stores only a digest of. One implementation, so
   * the "only the hash is stored" rule cannot hold for one and drift for the
   * other.
   */
  mintOpaqueToken(): { raw: string; hash: string } {
    const raw = randomBytes(32).toString('base64url');
    return { raw, hash: this.hashOpaqueToken(raw) };
  }

  hashOpaqueToken(raw: string): string {
    return createHash('sha256').update(raw).digest('hex');
  }

  /**
   * `RefreshToken.expiresAt` needs a concrete Date, but REFRESH_TOKEN_TTL is
   * a human duration string like "30d" — the same grammar `ms()` accepts
   * that envSchema already validates at boot (see JWT_DURATION_PATTERN).
   * Rather than hand-roll a second parser for that grammar — one that could
   * quietly disagree with jsonwebtoken's own — this borrows jsonwebtoken's
   * parsing by round-tripping a throwaway signed token through it and
   * reading back the `exp` claim it computed. No new dependency, and the
   * same library that governs the access token's expiry governs this too.
   */
  async refreshTokenExpiresAt(): Promise<Date> {
    const throwaway = await this.jwt.signAsync({}, { expiresIn: this.refreshTtl });
    const { exp } = this.jwt.decode<{ exp: number }>(throwaway);
    return new Date(exp * 1000);
  }
}
