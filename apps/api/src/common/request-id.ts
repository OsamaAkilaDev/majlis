import { randomUUID } from 'node:crypto';

/**
 * Shared by configure-app.ts's request-context middleware and
 * app.module.ts's pino-http genReqId fallback, so the "what counts as a
 * caller-supplied id" rule lives in exactly one place.
 *
 * A blank or whitespace-only `x-request-id` header is treated as absent: it
 * would satisfy `audit_log.request_id`'s NOT NULL constraint while being
 * useless for correlating anything.
 */
export function resolveRequestId(headerValue: unknown): string {
  return typeof headerValue === 'string' && headerValue.trim().length > 0 ? headerValue : randomUUID();
}
