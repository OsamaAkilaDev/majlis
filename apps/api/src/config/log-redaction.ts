/**
 * Paths stripped from every log line. A missing entry here means a secret in
 * the logs, so this is a security control rather than formatting.
 *
 * These match pino-http's actual serialized shape: request headers live
 * under `req.headers`, the parsed query string lives under `req.query`
 * (pino-http copies `req.query` verbatim — see
 * pino-std-serializers/lib/req.js), and response headers come from
 * `res.getHeaders()`.
 *
 * pino-http's request serializer does NOT serialize a request body at all —
 * the serialized shape is only
 * `{ id, method, url, query, params, headers, remoteAddress, remotePort }`.
 * A `req.body.*` redaction path is therefore inert: there is nothing at that
 * path for pino's redactor to ever find and strip. Do not add one back
 * expecting it to do anything.
 *
 * Known remaining exposure: `req.url` (and `req.raw.url`) still carries the
 * full raw query string verbatim, unredacted, because pino-http serializes
 * it as one opaque string rather than structured fields. A token passed as
 * `?token=...` is redacted out of `req.query.token` here but still appears
 * inside `req.url`. There is no path-based way to redact a substring of a
 * string value; avoiding this requires either not logging `req.url` at all,
 * or accepting the exposure. Stage 3 introduces invitation tokens carried in
 * query strings — revisit this before then.
 */
export const LOG_REDACT_PATHS = [
  'req.headers.cookie',
  'req.headers.authorization',
  'req.query.token',
  'req.query.code',
  'res.headers["set-cookie"]',
] as const;
