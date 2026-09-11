import { z } from 'zod';

const postgresUrl = z
  .string()
  .refine((v) => /^postgres(ql)?:\/\//.test(v), { message: 'must be a postgres:// URL' });

/**
 * The process refuses to start if any of this is wrong. A server that boots
 * with a broken configuration and fails on the first request is worse than
 * one that never boots.
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().max(65535).default(3001),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  DATABASE_URL: postgresUrl,
  DIRECT_URL: postgresUrl,
});

export type Env = z.infer<typeof envSchema>;
