import { createHash, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService, type JwtSignOptions } from '@nestjs/jwt';
import { UnauthorizedError } from '../common/problem/domain-error';
import type { Env } from '../config/env.schema';

@Injectable()
export class TokensService {
  /** Aligns two TypeScript types only. `envSchema` does the real validation,
   *  against the grammar `ms()` accepts, at boot. */
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
   * `{ sub, iat, exp }` and NOTHING else: no role, no club ids, no
   * permissions. Spec 6.2 promises losing an appointment takes effect on the
   * next request, and a role claim here would make that false for a whole
   * token TTL, invisibly: every test written against it would still pass.
   */
  async signAccessToken(userId: string): Promise<string> {
    return this.jwt.signAsync({}, { subject: userId, expiresIn: this.accessTtl });
  }

  /** `iat` is UNIX seconds, and is what SessionGuard compares against
   *  `user.sessionsInvalidatedAt`. */
  async verifyAccessToken(token: string): Promise<{ userId: string; issuedAt: number }> {
    try {
      const claims = await this.jwt.verifyAsync<{ sub: string; iat: number }>(token);
      return { userId: claims.sub, issuedAt: claims.iat };
    } catch {
      throw new UnauthorizedError('Invalid or expired access token');
    }
  }

  /** SHA-256, not argon2id: a 256-bit random string has no structure to guess
   *  and no dictionary to attack, so the work factor buys nothing and would
   *  add ~100ms to every refresh. Passwords stay argon2id. */
  mintRefreshToken(): { raw: string; hash: string } {
    return this.mintOpaqueToken();
  }

  hashRefreshToken(raw: string): string {
    return this.hashOpaqueToken(raw);
  }

  /** Shared by refresh and password-reset tokens, so "only the hash is
   *  stored" cannot hold for one and drift for the other. */
  mintOpaqueToken(): { raw: string; hash: string } {
    const raw = randomBytes(32).toString('base64url');
    return { raw, hash: this.hashOpaqueToken(raw) };
  }

  hashOpaqueToken(raw: string): string {
    return createHash('sha256').update(raw).digest('hex');
  }

  /**
   * `RefreshToken.expiresAt` needs a concrete Date, but REFRESH_TOKEN_TTL is
   * a human duration string like "30d", the same grammar `ms()` accepts
   * that envSchema already validates at boot (see JWT_DURATION_PATTERN).
   * Rather than hand-roll a second parser for that grammar (one that could
   * quietly disagree with jsonwebtoken's own), this borrows jsonwebtoken's
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
