import { z } from 'zod';

const postgresUrl = z
  .string()
  .refine((v) => /^postgres(ql)?:\/\//.test(v), { message: 'must be a postgres:// URL' });

/**
 * ACCESS_TOKEN_TTL and REFRESH_TOKEN_TTL are handed to jsonwebtoken's `sign()`
 * as `expiresIn`, which (for a string value) delegates to `ms()`
 * (jsonwebtoken@9.0.3 depends on ms@^2.1.1, resolved here to 2.1.3). `ms()`
 * returns `undefined` for anything it can't parse, and jsonwebtoken's
 * `timespan()` then makes `sign()` throw a plain `Error`: uncaught, that
 * surfaces as a bare 500 on the first login attempt. This regex is copied
 * from ms@2.1.3's own `parse()` (not imported: it's jsonwebtoken's
 * transitive dependency, not ours to depend on) so a malformed value is
 * rejected here, at boot, instead of there, on the first request.
 */
const JWT_DURATION_PATTERN =
  /^-?(?:\d+)?\.?\d+ *(milliseconds?|msecs?|ms|seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d|weeks?|w|years?|yrs?|y)?$/i;

const jwtDuration = z
  .string()
  .max(100, 'must be 100 characters or fewer, like ms() requires')
  .regex(JWT_DURATION_PATTERN, 'must be a duration ms() accepts, e.g. "15m" or "30d"')
  .refine(
    // ms() parses the leading numeric portion exactly like parseFloat does
    // (the regex above already guarantees the string matches its grammar),
    // so this is the same magnitude ms() itself would compute the sign of.
    // A zero or negative token lifetime is nonsensical ("0s" mints a token
    // that's already expired, and "-1s" one that expired before it existed),
    // and jsonwebtoken's sign() accepts either without complaint.
    (v) => parseFloat(v) > 0,
    { message: 'must be a positive duration (greater than zero)' },
  );

/**
 * The value shipped in .env.example. Fine for development (the repo should
 * clone and run), but a production process that boots with it is signing
 * every session with a secret published in a public repository.
 */
export const EXAMPLE_SESSION_SECRET = 'dev-only-session-secret-change-me!!';

/**
 * Same bargain as EXAMPLE_SESSION_SECRET: a default so the repo clones and
 * runs, and a production refusal so nobody ships the published one.
 */
export const EXAMPLE_LIFECYCLE_SWEEP_SECRET = 'dev-only-lifecycle-sweep-secret';

/**
 * Same bargain again, and the most expensive one to get wrong: this key
 * signs every QR pass in the product, so a deployment running on the
 * published example value lets anyone mint a pass for any user id they can
 * guess.
 */
export const EXAMPLE_QR_SIGNING_SECRET = 'dev-only-qr-signing-secret-change-me!!';

/** Same bargain again, for POST /internal/notification-sweep. */
export const EXAMPLE_NOTIFICATION_SWEEP_SECRET = 'dev-only-notification-sweep-secret';

/**
 * The process refuses to start if any of this is wrong. A server that boots
 * with a broken configuration and fails on the first request is worse than
 * one that never boots.
 */
export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().max(65535).default(3001),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
    DATABASE_URL: postgresUrl,
    SESSION_SECRET: z.string().min(32, 'must be at least 32 characters'),
    ACCESS_TOKEN_TTL: jwtDuration.default('15m'),
    REFRESH_TOKEN_TTL: jwtDuration.default('30d'),
    SUPABASE_STORAGE_URL: z
      .string()
      .refine((v) => v.startsWith('https://'), { message: 'must be an https URL' }),
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(20, 'must be a real service role key'),
    LIFECYCLE_SWEEP_SECRET: z
      .string()
      .min(16, 'must be at least 16 characters')
      .default(EXAMPLE_LIFECYCLE_SWEEP_SECRET),
    QR_SIGNING_SECRET: z
      .string()
      .min(32, 'must be at least 32 characters')
      .default(EXAMPLE_QR_SIGNING_SECRET),
    /**
     * Spec 7.5: Operations and Lead may correct attendance for 48 hours
     * after an event ends. It is also what gates COMPLETED to CERTIFIED:
     * issuing the moment an event completes would make this window zero.
     */
    ATTENDANCE_CORRECTION_WINDOW_HOURS: z.coerce.number().int().positive().max(8760).default(48),
    /**
     * Where the QR printed on a certificate points. The API is reached
     * through the web app's rewrite rather than directly, so it has no other
     * reason to know its own public origin, and a certificate carrying a
     * QR nobody can scan is a QR that may as well not be there.
     */
    PUBLIC_WEB_ORIGIN: z.url().default('http://localhost:3000'),
    NOTIFICATION_SWEEP_SECRET: z
      .string()
      .min(16, 'must be at least 16 characters')
      .default(EXAMPLE_NOTIFICATION_SWEEP_SECRET),
    /**
     * Optional by design (decided 2026-09-13): Resend ships unwired. With no
     * key the channel marks every notification SKIPPED and the in-app inbox
     * works completely; pasting a key in turns email on with no code change.
     *
     * No message here interpolates the value, so a validation failure names
     * the rule that was broken and never the credential that broke it.
     */
    RESEND_API_KEY: z.string().min(1, 'must not be empty').optional(),
    RESEND_FROM: z.string().min(3).default('Majlis <notifications@majlis.invalid>'),
  })
  .refine((env) => env.NODE_ENV !== 'production' || env.SESSION_SECRET !== EXAMPLE_SESSION_SECRET, {
    path: ['SESSION_SECRET'],
    message: 'must not be the example secret in production',
  })
  .refine(
    (env) => env.NODE_ENV !== 'production' || env.LIFECYCLE_SWEEP_SECRET !== EXAMPLE_LIFECYCLE_SWEEP_SECRET,
    { path: ['LIFECYCLE_SWEEP_SECRET'], message: 'must not be the example secret in production' },
  )
  .refine((env) => env.NODE_ENV !== 'production' || env.QR_SIGNING_SECRET !== EXAMPLE_QR_SIGNING_SECRET, {
    path: ['QR_SIGNING_SECRET'],
    message: 'must not be the example secret in production',
  })
  .refine(
    (env) =>
      env.NODE_ENV !== 'production' || env.NOTIFICATION_SWEEP_SECRET !== EXAMPLE_NOTIFICATION_SWEEP_SECRET,
    { path: ['NOTIFICATION_SWEEP_SECRET'], message: 'must not be the example secret in production' },
  );

export type Env = z.infer<typeof envSchema>;
