import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { beforeEach, describe, expect, it } from 'vitest';
import { UnauthorizedError } from '../common/problem/domain-error';
import type { Env } from '../config/env.schema';
import { TokensService } from './tokens.service';

function configWithTtl(accessTokenTtl: string, refreshTokenTtl = '30d'): ConfigService<Env, true> {
  return new ConfigService({ ACCESS_TOKEN_TTL: accessTokenTtl, REFRESH_TOKEN_TTL: refreshTokenTtl });
}

describe('TokensService', () => {
  let service: TokensService;
  const secret = 'x'.repeat(32);

  beforeEach(() => {
    service = new TokensService(new JwtService({ secret }), configWithTtl('15m'));
  });

  describe('mintRefreshToken', () => {
    it('never returns the raw refresh token as its own hash', () => {
      // Catches: a refresh token stored raw rather than hashed, which turns
      // a leaked RefreshToken row into a live session for anyone who reads it.
      const { raw, hash } = service.mintRefreshToken();
      expect(hash).not.toBe(raw);
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('draws 32 bytes (256 bits) of entropy for the raw token', () => {
      // Catches: a regression to a short or predictable generator (e.g.
      // randomBytes(8), or Math.random().toString(36)). SHA-256 always
      // emits 64 hex chars no matter what it's fed, so the hash-shape
      // assertion above passes regardless of the raw token's real entropy.
      // This is the only assertion that constrains the raw token itself.
      const { raw } = service.mintRefreshToken();
      expect(Buffer.from(raw, 'base64url').length).toBe(32);
    });

    it('mints a different token every time', () => {
      const seen = new Set(Array.from({ length: 50 }, () => service.mintRefreshToken().raw));
      expect(seen.size).toBe(50);
    });

    it('hashes deterministically, so a presented token finds its row', () => {
      const { raw, hash } = service.mintRefreshToken();
      expect(service.hashRefreshToken(raw)).toBe(hash);
    });
  });

  describe('signAccessToken', () => {
    it('puts nothing but sub, iat and exp in the access token', async () => {
      // Catches: a role/club/permission claim added to "save a query", which
      // would make permission changes take up to 15 minutes to take effect
      // instead of the very next request, invisibly.
      const token = await service.signAccessToken('user-id-1');
      const claims = JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString());
      expect(Object.keys(claims).sort()).toEqual(['exp', 'iat', 'sub']);
      expect(claims.sub).toBe('user-id-1');
    });
  });

  describe('verifyAccessToken', () => {
    it('returns the sub and iat of a token it signed', async () => {
      const token = await service.signAccessToken('user-id-2');
      const claims = await service.verifyAccessToken(token);
      expect(claims.userId).toBe('user-id-2');
      // SessionGuard compares this against sessionsInvalidatedAt, so a missing
      // or non-numeric iat would silently disable that check.
      expect(claims.issuedAt).toBeTypeOf('number');
    });

    it('rejects a token signed with a different secret', async () => {
      const other = new TokensService(new JwtService({ secret: 'y'.repeat(32) }), configWithTtl('15m'));
      const foreignToken = await other.signAccessToken('u');
      await expect(service.verifyAccessToken(foreignToken)).rejects.toThrow(UnauthorizedError);
    });

    it('rejects an expired token', async () => {
      const shortLived = new TokensService(new JwtService({ secret }), configWithTtl('-1s'));
      const expiredToken = await shortLived.signAccessToken('u');
      await expect(service.verifyAccessToken(expiredToken)).rejects.toThrow(UnauthorizedError);
    });

    it('rejects garbage input rather than throwing an unhandled error', async () => {
      await expect(service.verifyAccessToken('not-a-jwt')).rejects.toThrow(UnauthorizedError);
    });
  });

  describe('refreshTokenExpiresAt', () => {
    it('resolves a TTL string into a Date roughly that far in the future', async () => {
      // Catches a parser that silently drops the unit (e.g. treats "30d" as
      // 30 milliseconds). The assertion window is wide but would still
      // fail for an off-by-a-thousand or off-by-86400 error.
      const before = Date.now();
      const expiresAt = await service.refreshTokenExpiresAt();
      const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
      expect(expiresAt.getTime()).toBeGreaterThan(before + thirtyDaysMs - 5000);
      expect(expiresAt.getTime()).toBeLessThan(before + thirtyDaysMs + 5000);
    });

    it('reflects a different configured duration', async () => {
      const oneHour = new TokensService(new JwtService({ secret }), configWithTtl('15m', '1h'));
      const before = Date.now();
      const expiresAt = await oneHour.refreshTokenExpiresAt();
      const oneHourMs = 60 * 60 * 1000;
      expect(expiresAt.getTime()).toBeGreaterThan(before + oneHourMs - 5000);
      expect(expiresAt.getTime()).toBeLessThan(before + oneHourMs + 5000);
    });
  });
});
