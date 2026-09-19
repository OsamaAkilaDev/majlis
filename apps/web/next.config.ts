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
  /**
   * Next's default is 0, which means the client Router Cache keeps nothing for
   * a dynamic route, and every screen here is dynamic: they read cookies() and
   * fetch no-store. Leaving a page and coming back therefore re-requested the
   * whole RSC payload and showed loading.tsx again.
   *
   * Three minutes, not the 30 seconds this started at: browsing a club, an
   * event under it and back is well over half a minute of reading, and every
   * return paid for a full round trip and a skeleton. Nothing goes stale
   * behind it, because lib/api.ts refreshes the router after every write from
   * this tab; three minutes is only how long another person's change takes to
   * show up on a screen nobody has touched.
   */
  experimental: { staleTimes: { dynamic: 180, static: 180 } },
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
