import { z } from 'zod';

const postgresUrl = z
  .string()
  .refine((v) => /^postgres(ql)?:\/\//.test(v), { message: 'must be a postgres:// URL' });

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
    ACCESS_TOKEN_TTL: z.string().default('15m'),
    REFRESH_TOKEN_TTL: z.string().default('30d'),
  })
  .refine((env) => env.NODE_ENV !== 'production' || env.SESSION_SECRET !== EXAMPLE_SESSION_SECRET, {
    path: ['SESSION_SECRET'],
    message: 'must not be the example secret in production',
  });

export type Env = z.infer<typeof envSchema>;
