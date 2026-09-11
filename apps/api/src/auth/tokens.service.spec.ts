import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { beforeEach, describe, expect, it } from 'vitest';
import { UnauthorizedError } from '../common/problem/domain-error';
import type { Env } from '../config/env.schema';
import { TokensService } from './tokens.service';

function configWithTtl(accessTokenTtl: string): ConfigService<Env, true> {
  return new ConfigService({ ACCESS_TOKEN_TTL: accessTokenTtl });
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
    it('returns the sub of a token it signed', async () => {
      const token = await service.signAccessToken('user-id-2');
      await expect(service.verifyAccessToken(token)).resolves.toBe('user-id-2');
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
});
