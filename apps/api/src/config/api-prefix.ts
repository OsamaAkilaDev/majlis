/**
 * The global route prefix.
 *
 * The leading slash is load-bearing. @nestjs/core's registerNotFoundHandler
 * and registerExceptionHandler skip the addLeadingSlash normalisation that
 * registerRouter applies, so 'api/v1' would route 404s and unhandled errors
 * around every exception filter — returning Nest's default error shape
 * instead of Problem Details, silently.
 */
export const API_PREFIX = '/api/v1';
