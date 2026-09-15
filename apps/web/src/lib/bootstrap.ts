import { cache } from 'react';
import { bootstrapStatusSchema } from '@majlis/contracts';
import { API_ORIGIN } from '@/lib/api-origin';

/**
 * Whether the platform still has no admin, and so whether the create-admin
 * screen is open. Memoised per request the same way getSessionUser is:
 * /login checks it to decide whether to redirect, and /setup checks it again
 * to decide whether to render.
 *
 * Fails CLOSED. An unreachable API, a non-JSON body, or any status but 200
 * answers "an admin exists", so an outage shows the ordinary sign-in screen
 * instead of offering the platform to whoever reloads during it. Guessing
 * the other way would turn every blip into an open claim on the deployment.
 *
 * Never cached across requests: `needsAdmin` flips exactly once in the life
 * of a deployment, and a stale `true` keeps offering a screen that now
 * hands out a 409 while a stale `false` locks the real admin out of setup.
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
