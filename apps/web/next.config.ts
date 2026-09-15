import type { NextConfig } from 'next';

// Duplicated from src/lib/api-origin.ts on purpose: next.config.ts is loaded
// before the module graph exists, so it cannot import from src.
function apiOrigin(): string {
  const origin = process.env.API_ORIGIN;
  if (origin) return origin;
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'API_ORIGIN must be set in production: it is the origin /api/v1 requests are rewritten to.',
    );
  }
  return 'http://localhost:3001';
}

const nextConfig: NextConfig = {
  reactStrictMode: true,
  async rewrites() {
    return [{ source: '/api/v1/:path*', destination: `${apiOrigin()}/api/v1/:path*` }];
  },
  /**
   * Three headers, deliberately, on every response.
   *
   * No Content-Security-Policy. The app renders inline styles and a
   * server-generated inline SVG, so a policy tight enough to be worth having
   * breaks rendering, and a policy loose enough not to (`unsafe-inline`)
   * buys nothing. A wrong CSP fails silently in the one place it matters, so
   * it belongs in its own change with a nonce plumbed through the render.
   */
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          // The product has no embeddable surface. SAMEORIGIN would still
          // allow /verify/{code} to be framed by another page of our own,
          // which is the only clickjacking target here.
          { key: 'X-Frame-Options', value: 'DENY' },
        ],
      },
    ];
  },
};

export default nextConfig;
