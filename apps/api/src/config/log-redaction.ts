/**
 * Paths stripped from every log line. A missing entry here means a secret in
 * the logs, so this is a security control rather than formatting.
 *
 * The shapes match what pino-http actually serialises: request headers live
 * under `req.headers`, and response headers come from `res.getHeaders()`.
 */
export const LOG_REDACT_PATHS = [
  'req.headers.cookie',
  'req.headers.authorization',
  'req.body.password',
  'req.body.token',
  'res.headers["set-cookie"]',
] as const;
