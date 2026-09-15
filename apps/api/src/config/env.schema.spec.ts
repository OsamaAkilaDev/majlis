import { describe, expect, it } from 'vitest';
import {
  EXAMPLE_NOTIFICATION_SWEEP_SECRET,
  EXAMPLE_QR_SIGNING_SECRET,
  EXAMPLE_SESSION_SECRET,
  envSchema,
} from './env.schema';

const valid = {
  DATABASE_URL: 'postgresql://majlis:majlis@localhost:5432/majlis_dev?schema=public',
  SESSION_SECRET: EXAMPLE_SESSION_SECRET,
  SUPABASE_STORAGE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'x'.repeat(40),
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
  SESSION_SECRET: 'x'.repeat(32),
  SUPABASE_STORAGE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'x'.repeat(40),
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

describe('token TTL format', () => {
  // Catches: no format validation at all (the pre-fix state), where a typo
  // like "15 minutes" or "fifteen" boots the server cleanly and then makes
  // jsonwebtoken's sign() throw a plain, uncaught Error on the first login,
  // an accidental 500 instead of a boot-time failure.
  it.each(['15m', '30d', '15 m', '15min', '1h', '900', '1.5h', '1000ms', '15 minutes'])(
    'accepts %s, a form ms() parses',
    (ttl) => {
      const r = envSchema.safeParse({ ...base, ACCESS_TOKEN_TTL: ttl });
      expect(r.success).toBe(true);
    },
  );

  it.each(['fifteen', '15mo', 'm15', '', '15h ago', 'x'.repeat(101)])(
    'rejects %s, a form ms() cannot parse',
    (ttl) => {
      const r = envSchema.safeParse({ ...base, ACCESS_TOKEN_TTL: ttl });
      expect(r.success).toBe(false);
    },
  );

  it.each(['0s', '-1s', '0', '-15m'])(
    'rejects %s: a zero or negative TTL boots cleanly and mints an already-expired token',
    (ttl) => {
      // Catches the pre-fix gap: this note previously (wrongly) claimed a
      // positivity rule would break tokens.service.spec.ts. It does not:
      // that spec constructs `new ConfigService({...})` directly, bypassing
      // envSchema entirely. Only this accept-list asserted the undesired
      // behaviour, and it was wrong to.
      const r = envSchema.safeParse({ ...base, ACCESS_TOKEN_TTL: ttl });
      expect(r.success).toBe(false);
    },
  );

  it('applies the same validation to REFRESH_TOKEN_TTL', () => {
    const r = envSchema.safeParse({ ...base, REFRESH_TOKEN_TTL: 'not-a-duration' });
    expect(r.success).toBe(false);
  });

  it('rejects a negative REFRESH_TOKEN_TTL too', () => {
    const r = envSchema.safeParse({ ...base, REFRESH_TOKEN_TTL: '-30d' });
    expect(r.success).toBe(false);
  });
});

describe('SUPABASE_STORAGE_URL', () => {
  it('rejects an http Supabase URL, which would send the service key in clear', () => {
    const r = envSchema.safeParse({ ...base, SUPABASE_STORAGE_URL: 'http://example.supabase.co' });
    expect(r.success).toBe(false);
  });
});

describe('QR_SIGNING_SECRET', () => {
  it('rejects a secret shorter than 32 characters', () => {
    // This key signs every QR pass. A short one is brute-forceable offline
    // from a single scanned image, and every pass in the product is then
    // forgeable.
    const r = envSchema.safeParse({ ...base, QR_SIGNING_SECRET: 'x'.repeat(31) });
    expect(r.success).toBe(false);
  });

  it('rejects the example secret when NODE_ENV=production', () => {
    const r = envSchema.safeParse({
      ...base,
      NODE_ENV: 'production',
      QR_SIGNING_SECRET: EXAMPLE_QR_SIGNING_SECRET,
    });
    expect(r.success).toBe(false);
    expect(r.error?.issues.some((i) => i.path[0] === 'QR_SIGNING_SECRET')).toBe(true);
  });

  it('defaults to the example secret in development, so the repo clones and runs', () => {
    expect(envSchema.parse(base).QR_SIGNING_SECRET).toBe(EXAMPLE_QR_SIGNING_SECRET);
  });
});

describe('NOTIFICATION_SWEEP_SECRET', () => {
  it('rejects the example secret when NODE_ENV=production', () => {
    const r = envSchema.safeParse({
      ...base,
      NODE_ENV: 'production',
      SESSION_SECRET: 'y'.repeat(40),
      NOTIFICATION_SWEEP_SECRET: EXAMPLE_NOTIFICATION_SWEEP_SECRET,
    });
    expect(r.success).toBe(false);
    expect(r.error?.issues.some((i) => i.path[0] === 'NOTIFICATION_SWEEP_SECRET')).toBe(true);
  });

  it('defaults to the example secret in development, so the repo clones and runs', () => {
    expect(envSchema.parse(base).NOTIFICATION_SWEEP_SECRET).toBe(EXAMPLE_NOTIFICATION_SWEEP_SECRET);
  });

  it('rejects a secret shorter than 16 characters', () => {
    const r = envSchema.safeParse({ ...base, NOTIFICATION_SWEEP_SECRET: 'x'.repeat(15) });
    expect(r.success).toBe(false);
  });
});

describe('RESEND_API_KEY', () => {
  it('is absent by default, which is what makes the channel skip', () => {
    // Resend ships unwired. If this ever gained a default the factory in
    // NotificationsModule would construct a real ResendChannel at boot with
    // a bogus key, and every notification would land on FAILED instead of
    // SKIPPED.
    expect(envSchema.parse(base).RESEND_API_KEY).toBeUndefined();
  });

  it('rejects an empty string rather than treating it as configured', () => {
    // An empty RESEND_API_KEY in a .env is the shape a half-finished
    // deployment takes. Accepting it would be indistinguishable from absent
    // here but not in the factory, which only checks for falsiness, so the
    // refusal belongs at boot where it is visible.
    const r = envSchema.safeParse({ ...base, RESEND_API_KEY: '' });
    expect(r.success).toBe(false);
    expect(r.error?.issues.some((i) => i.path[0] === 'RESEND_API_KEY')).toBe(true);
  });
});
