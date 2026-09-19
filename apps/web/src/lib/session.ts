import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import { sessionUserSchema, type SessionUser } from '@majlis/contracts';
import { API_ORIGIN } from '@/lib/api-origin';
import { landingFor } from '@/lib/routing';

/** Memoised per request: a layout and its shell both need the viewer, and that
 *  must stay one call to /auth/me. */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const cookie = (await cookies()).toString();
  if (!cookie) return null;

  try {
    const res = await fetch(`${API_ORIGIN}/api/v1/auth/me`, {
      headers: { cookie, accept: 'application/json' },
      cache: 'no-store',
    });
    if (!res.ok) return null;

    const parsed = sessionUserSchema.safeParse(await res.json());
    return parsed.success ? parsed.data : null;
  } catch {
    // Fail closed, never 500 the page. Never log this: the caught error can
    // carry request headers, cookie included.
    return null;
  }
});

/** Spec 9.1: never render a page and then an "authentication required" panel
 *  inside it. Layouts call this before returning any markup. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  return user;
}

/**
 * Only /login and /signup call this. The reset routes deliberately do not:
 * somebody who requests a link on their phone and opens it on a laptop where
 * they are still signed in has to be able to use it.
 */
export async function bounceIfSignedIn(): Promise<void> {
  const user = await getSessionUser();
  if (user) redirect(landingFor(user));
}
