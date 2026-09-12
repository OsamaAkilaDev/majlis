import { cookies } from 'next/headers';
import { cache } from 'react';
import { API_ORIGIN } from '@/lib/api-origin';

/** Memoised per request, so two components asking for the same path is one call. */
const fetchJson = cache(async (path: string): Promise<unknown> => {
  try {
    const res = await fetch(`${API_ORIGIN}/api/v1${path}`, {
      headers: { cookie: (await cookies()).toString(), accept: 'application/json' },
      cache: 'no-store',
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    // Null, never a throw: a 401 or a dead API must leave the client component
    // to fetch and report rather than 500 the page. Never log this: the caught
    // error can carry request headers, cookie included.
    return null;
  }
});

/**
 * Server-side twin of lib/api.ts, which fetches a relative path and so has no
 * origin in a Server Component. Returns null on any failure; every caller
 * treats its result as a first-paint hint that the client can refetch.
 */
export async function serverFetch<T>(path: string): Promise<T | null> {
  return (await fetchJson(path)) as T | null;
}
