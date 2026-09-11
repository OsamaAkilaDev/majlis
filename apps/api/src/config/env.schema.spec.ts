import { describe, expect, it } from 'vitest';
import { EXAMPLE_SESSION_SECRET, envSchema } from './env.schema';

const valid = {
  DATABASE_URL: 'postgresql://majlis:majlis@localhost:5432/majlis_dev?schema=public',
  DIRECT_URL: 'postgresql://majlis:majlis@localhost:5432/majlis_dev?schema=public',
  SESSION_SECRET: EXAMPLE_SESSION_SECRET,
};

describe('envSchema', () => {
  it('applies defaults for the optional variables', () => {
    const env = envSchema.parse(valid);
    expect(env.NODE_ENV).toBe('development');
    expect(env.PORT).toBe(3001);
    expect(env.LOG_LEVEL).toBe('info');
  });

  it('coerces PORT from the string the environment always gives us', () => {
    expect(envSchema.parse({ ...valid, PORT: '8080' }).PORT).toBe(8080);
  });

  it('rejects a missing DATABASE_URL rather than starting a broken server', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- destructured only to omit it
    const { DATABASE_URL: _omitted, ...rest } = valid;
    expect(() => envSchema.parse(rest)).toThrow();
  });

  it('rejects a DATABASE_URL that is not a postgres URL', () => {
    expect(() => envSchema.parse({ ...valid, DATABASE_URL: 'mysql://localhost/x' })).toThrow();
  });

  it('accepts the postgres:// scheme as well as postgresql://', () => {
    expect(() => envSchema.parse({ ...valid, DATABASE_URL: 'postgres://a:b@h:5432/d' })).not.toThrow();
  });

  it('rejects an unknown NODE_ENV', () => {
    expect(() => envSchema.parse({ ...valid, NODE_ENV: 'staging' })).toThrow();
  });
});

const base = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/d',
  DIRECT_URL: 'postgresql://u:p@localhost:5432/d',
  SESSION_SECRET: 'x'.repeat(32),
};

describe('SESSION_SECRET', () => {
  it('rejects a secret shorter than 32 characters', () => {
    const r = envSchema.safeParse({ ...base, SESSION_SECRET: 'x'.repeat(31) });
    expect(r.success).toBe(false);
  });

  it('rejects the example secret when NODE_ENV=production', () => {
    const r = envSchema.safeParse({
      ...base,
      NODE_ENV: 'production',
      SESSION_SECRET: EXAMPLE_SESSION_SECRET,
    });
    expect(r.success).toBe(false);
  });

  it('allows the example secret in development, so the repo clones and runs', () => {
    const r = envSchema.safeParse({ ...base, SESSION_SECRET: EXAMPLE_SESSION_SECRET });
    expect(r.success).toBe(true);
  });

  it('defaults the token lifetimes to the spec values', () => {
    const r = envSchema.parse(base);
    expect(r.ACCESS_TOKEN_TTL).toBe('15m');
    expect(r.REFRESH_TOKEN_TTL).toBe('30d');
  });
});
