/** Server-side only. Never derive the API origin from request headers: the
 *  cookie header rides along, so a spoofed Host would exfiltrate the token. */
export const API_ORIGIN = process.env.API_ORIGIN ?? 'http://localhost:3001';
