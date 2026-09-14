import { randomUUID } from 'node:crypto';

/**
 * Conservative allowlist for a caller-supplied correlation id: ASCII
 * alphanumerics plus the handful of separators real id generators use
 * (`.`, `_`, `~`, `-`), capped at 64 characters. Anything else (including a
 * value with no cap at all) is rejected rather than stored, because this
 * string lands verbatim in `audit_log.request_id`, an append-only column
 * with no delete path. Without this, an unauthenticated caller could stamp
 * an arbitrary string (e.g. a correlation id copied off an admin's own
 * response header) onto a `permission.denied` or
 * `auth.refresh.reuse_detected` row forever.
 */
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._~-]{1,64}$/;

/**
 * Shared by configure-app.ts's request-context middleware and
 * app.module.ts's pino-http genReqId fallback, so the "what counts as a
 * caller-supplied id" rule lives in exactly one place.
 *
 * A blank, whitespace-only, malformed, or over-long `x-request-id` header is
 * treated as absent and replaced with a fresh UUID.
 */
export function resolveRequestId(headerValue: unknown): string {
  return typeof headerValue === 'string' && REQUEST_ID_PATTERN.test(headerValue)
    ? headerValue
    : randomUUID();
}
