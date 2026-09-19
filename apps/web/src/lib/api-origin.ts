/** Server-side only. Never derive this from request headers: the cookie rides
 *  along, so a spoofed Host would exfiltrate the token. */
function resolve(): string {
  const origin = process.env.API_ORIGIN;
  if (origin) return origin;

  // Falling back to localhost in production rewrites every call to a host that
  // is not there, and login fails with no error anyone can read.
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'API_ORIGIN must be set in production: it is the origin /api/v1 requests are rewritten to.',
    );
  }
  return 'http://localhost:3001';
}

export const API_ORIGIN = resolve();
