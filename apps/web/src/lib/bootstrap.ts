import { cache } from 'react';
import { bootstrapStatusSchema } from '@majlis/contracts';
import { API_ORIGIN } from '@/lib/api-origin';

/**
 * Fails CLOSED: anything but a 200 saying otherwise answers "an admin
 * exists", so an outage shows the sign-in screen rather than offering the
 * platform to whoever reloads during it.
 *
 * Memoised per request, never across them: a stale `true` keeps offering a
 * screen that now 409s, a stale `false` locks the real admin out of setup.
 */
export const needsAdmin = cache(async (): Promise<boolean> => {
  try {
    const res = await fetch(`${API_ORIGIN}/api/v1/auth/bootstrap`, {
      headers: { accept: 'application/json' },
      cache: 'no-store',
    });
    if (!res.ok) return false;

    const parsed = bootstrapStatusSchema.safeParse(await res.json());
    return parsed.success && parsed.data.needsAdmin;
  } catch {
    return false;
  }
});
