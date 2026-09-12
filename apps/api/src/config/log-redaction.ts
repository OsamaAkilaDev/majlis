import { stdSerializers, type SerializedRequest } from 'pino';

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
 * `req.url` (and `req.raw.url`) carries the full raw query string verbatim,
 * unredacted, because pino-http serializes it as one opaque string rather
 * than structured fields — no path-based redaction can strip a substring out
 * of it. That gap is closed below: `redactedReqSerializer` truncates `url` at
 * the `?` before pino ever sees it, which matters now that Stage 4's
 * invitation tokens travel in a query string.
 */
export const LOG_REDACT_PATHS = [
  'req.headers.cookie',
  'req.headers.authorization',
  'req.query.token',
  'req.query.code',
  'res.headers["set-cookie"]',
  // ProblemExceptionFilter logs `{ err }` on every 5xx; an error carrying an
  // attached request (e.g. an axios/http client error) would serialize that
  // request's headers unredacted, since the paths above are rooted at req/res
  // and do not reach err.*. The wildcard covers err at any nesting depth.
  '*.headers.cookie',
  '*.headers.authorization',
] as const;

/**
 * pino serializes req.url as one opaque string, so no redaction path can
 * strip a secret out of its query. The structured req.query is redacted by
 * the paths above; this drops the duplicate raw copy, keeping the path (the
 * part that carries the observability value) and discarding the query.
 */
export function redactedReqSerializer(req: Parameters<typeof stdSerializers.req>[0]): SerializedRequest {
  const serialized = stdSerializers.req(req);
  const cut = serialized.url.indexOf('?');
  return cut === -1 ? serialized : { ...serialized, url: serialized.url.slice(0, cut) };
}
