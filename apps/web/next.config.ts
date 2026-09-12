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
};

export default nextConfig;
