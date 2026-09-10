import { describe, expect, it } from 'vitest';
import { envSchema } from './env.schema';

const valid = {
  DATABASE_URL: 'postgresql://majlis:majlis@localhost:5432/majlis_dev?schema=public',
  DIRECT_URL: 'postgresql://majlis:majlis@localhost:5432/majlis_dev?schema=public',
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
