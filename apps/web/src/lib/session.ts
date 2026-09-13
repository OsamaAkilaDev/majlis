import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import { sessionUserSchema, type SessionUser } from '@majlis/contracts';
import { API_ORIGIN } from '@/lib/api-origin';
import { landingFor } from '@/lib/routing';

/** Memoised per request: a layout and the shell it renders both need the
 *  viewer, and that must stay one call to /auth/me, not two. */
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
    // A dead API or a non-JSON body must fail closed, not 500 the page. Never
    // log this: the caught error can carry request headers, cookie included.
    return null;
  }
});

/**
 * Never render a page and then show an "authentication required" panel inside
 * it (spec 9.1). Layouts call this before returning any markup.
 */
export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  return user;
}

/**
 * The inverse: sends a visitor who already holds a live session to their
 * landing page. Only /login and /signup call it.
 *
 * The two reset routes deliberately do not, and the (auth) layout no longer
 * does it for the whole group: somebody who asks for a reset link on their
 * phone and opens the mail on a laptop where they are still signed in has to
 * be able to use it, and there is no change-password screen anywhere else to
 * send them to.
 */
export async function bounceIfSignedIn(): Promise<void> {
  const user = await getSessionUser();
  if (user) redirect(landingFor(user));
}
