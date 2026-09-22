import { stdSerializers, type SerializedRequest } from 'pino';
import { NOTIFICATION_SWEEP_SECRET_HEADER, SWEEP_SECRET_HEADER } from './sweep-header';

/**
 * A missing entry here is a secret in the logs: a security control, not
 * formatting. The paths match pino-http's serialized shape.
 *
 * pino-http does NOT serialize a request body at all, so a `req.body.*` path
 * is inert. Do not add one back expecting it to do anything.
 *
 * `req.url` carries the raw query string as one opaque string, which no
 * path-based redaction can strip a substring out of. That gap is closed by
 * `redactedReqSerializer` below.
 */
export const LOG_REDACT_PATHS = [
  'req.headers.cookie',
  'req.headers.authorization',
  'req.query.token',
  'req.query.code',
  // Defensive today, since the QR token travels in a POST body. Here so a
  // later move into a query string cannot silently log a live credential.
  'req.query.pass',
  'res.headers["set-cookie"]',
  // The filter logs `{ err }` on every 5xx, and an error carrying an attached
  // request would serialize its headers unredacted: the paths above are
  // rooted at req/res and never reach err.*.
  '*.headers.cookie',
  '*.headers.authorization',
  // autoLogging serializes the whole headers object, so without these every
  // call to the sweep endpoint, failed guesses included, logged it verbatim.
  `req.headers["${SWEEP_SECRET_HEADER}"]`,
  `*.headers["${SWEEP_SECRET_HEADER}"]`,
  // The delivery sweep's own secret. Stage 5 shipped one without its pair
  // here and it landed verbatim in every request log.
  `req.headers["${NOTIFICATION_SWEEP_SECRET_HEADER}"]`,
  `*.headers["${NOTIFICATION_SWEEP_SECRET_HEADER}"]`,
  // Brevo authenticates on a header literally named `api-key`, which
  // neither the cookie nor the authorization path above covers. Defensive
  // today, since nothing serializes the outbound fetch: here so an
  // http-client error carrying its own request cannot log a live credential.
  'req.headers["api-key"]',
  '*.headers["api-key"]',
  // The same key in an object carrying configuration, which no req.headers
  // path would see: a bootstrap dump, or an error with process.env on it.
  // Bare key for top level, wildcard for any depth.
  'BREVO_API_KEY',
  '*.BREVO_API_KEY',
] as const;

/** Drops the raw query from req.url, which no redaction path can reach into.
 *  The structured req.query is covered by the paths above. */
export function redactedReqSerializer(req: Parameters<typeof stdSerializers.req>[0]): SerializedRequest {
  const serialized = stdSerializers.req(req);
  const cut = serialized.url.indexOf('?');
  return cut === -1 ? serialized : { ...serialized, url: serialized.url.slice(0, cut) };
}
