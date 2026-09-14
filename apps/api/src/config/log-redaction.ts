import { stdSerializers, type SerializedRequest } from 'pino';
import { NOTIFICATION_SWEEP_SECRET_HEADER, SWEEP_SECRET_HEADER } from './sweep-header';

/**
 * Paths stripped from every log line. A missing entry here means a secret in
 * the logs, so this is a security control rather than formatting.
 *
 * These match pino-http's actual serialized shape: request headers live
 * under `req.headers`, the parsed query string lives under `req.query`
 * (pino-http copies `req.query` verbatim, see
 * pino-std-serializers/lib/req.js), and response headers come from
 * `res.getHeaders()`.
 *
 * pino-http's request serializer does NOT serialize a request body at all:
 * the serialized shape is only
 * `{ id, method, url, query, params, headers, remoteAddress, remotePort }`.
 * A `req.body.*` redaction path is therefore inert: there is nothing at that
 * path for pino's redactor to ever find and strip. Do not add one back
 * expecting it to do anything.
 *
 * `req.url` (and `req.raw.url`) carries the full raw query string verbatim,
 * unredacted, because pino-http serializes it as one opaque string rather
 * than structured fields, and no path-based redaction can strip a substring
 * out of it. That gap is closed below: `redactedReqSerializer` truncates
 * `url` at the `?` before pino ever sees it, which matters now that Stage 4's
 * invitation tokens travel in a query string.
 */
export const LOG_REDACT_PATHS = [
  'req.headers.cookie',
  'req.headers.authorization',
  'req.query.token',
  'req.query.code',
  // The QR pass token travels in a POST body, which pino-http never
  // serializes (see above), so this is defensive rather than load-bearing
  // today. It is here because a later change that moves the token into a
  // query string (a prefetched image URL, a deep link) would otherwise put
  // a live credential into every log line silently.
  'req.query.pass',
  'res.headers["set-cookie"]',
  // ProblemExceptionFilter logs `{ err }` on every 5xx; an error carrying an
  // attached request (e.g. an axios/http client error) would serialize that
  // request's headers unredacted, since the paths above are rooted at req/res
  // and do not reach err.*. The wildcard covers err at any nesting depth.
  '*.headers.cookie',
  '*.headers.authorization',
  // Spec 11 names the sweep secret alongside session secrets and signing keys
  // as something that never reaches a log. autoLogging serializes the whole
  // headers object, so every call to the sweep endpoint, failed guesses
  // included, wrote it verbatim without these.
  `req.headers["${SWEEP_SECRET_HEADER}"]`,
  `*.headers["${SWEEP_SECRET_HEADER}"]`,
  // The notification delivery sweep's own secret, added in the same commit
  // that introduced it. Stage 5 shipped a sweep secret without this pair and
  // it landed verbatim in every request log, successful and failed alike.
  `req.headers["${NOTIFICATION_SWEEP_SECRET_HEADER}"]`,
  `*.headers["${NOTIFICATION_SWEEP_SECRET_HEADER}"]`,
  // Spec 11 names the Resend key alongside the signing keys as something
  // that never reaches a log. Unlike the two sweep secrets it does not
  // travel in a request header, so no req.headers path would ever see it:
  // the shape that puts it in a line is an object carrying configuration,
  // which is what a bootstrap dump and an error with `process.env` attached
  // both are. The bare key covers a top-level one, the wildcard covers it
  // at any nesting depth.
  'RESEND_API_KEY',
  '*.RESEND_API_KEY',
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
