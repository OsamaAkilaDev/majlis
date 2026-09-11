import { z } from 'zod';

const postgresUrl = z
  .string()
  .refine((v) => /^postgres(ql)?:\/\//.test(v), { message: 'must be a postgres:// URL' });

/**
 * ACCESS_TOKEN_TTL and REFRESH_TOKEN_TTL are handed to jsonwebtoken's `sign()`
 * as `expiresIn`, which — for a string value — delegates to `ms()`
 * (jsonwebtoken@9.0.3 depends on ms@^2.1.1, resolved here to 2.1.3). `ms()`
 * returns `undefined` for anything it can't parse, and jsonwebtoken's
 * `timespan()` then makes `sign()` throw a plain `Error` — uncaught, that
 * surfaces as a bare 500 on the first login attempt. This regex is copied
 * from ms@2.1.3's own `parse()` (not imported — it's jsonwebtoken's
 * transitive dependency, not ours to depend on) so a malformed value is
 * rejected here, at boot, instead of there, on the first request.
 */
const JWT_DURATION_PATTERN =
  /^-?(?:\d+)?\.?\d+ *(milliseconds?|msecs?|ms|seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d|weeks?|w|years?|yrs?|y)?$/i;

const jwtDuration = z
  .string()
  .max(100, 'must be 100 characters or fewer, like ms() requires')
  .regex(JWT_DURATION_PATTERN, 'must be a duration ms() accepts, e.g. "15m" or "30d"');

/**
 * The value shipped in .env.example. Fine for development — the repo should
 * clone and run — but a production process that boots with it is signing
 * every session with a secret published in a public repository.
 */
export const EXAMPLE_SESSION_SECRET = 'dev-only-session-secret-change-me!!';

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
    DIRECT_URL: postgresUrl,
    SESSION_SECRET: z.string().min(32, 'must be at least 32 characters'),
    ACCESS_TOKEN_TTL: jwtDuration.default('15m'),
    REFRESH_TOKEN_TTL: jwtDuration.default('30d'),
  })
  .refine((env) => env.NODE_ENV !== 'production' || env.SESSION_SECRET !== EXAMPLE_SESSION_SECRET, {
    path: ['SESSION_SECRET'],
    message: 'must not be the example secret in production',
  });

export type Env = z.infer<typeof envSchema>;
