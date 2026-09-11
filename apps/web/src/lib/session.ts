import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { sessionUserSchema, type SessionUser } from '@majlis/contracts';

async function origin(): Promise<string> {
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000';
  const proto = h.get('x-forwarded-proto') ?? 'http';
  return `${proto}://${host}`;
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const cookie = (await cookies()).toString();
  if (!cookie) return null;

  const res = await fetch(`${await origin()}/api/v1/auth/me`, {
    headers: { cookie, accept: 'application/json' },
    cache: 'no-store',
  });
  if (!res.ok) return null;

  const parsed = sessionUserSchema.safeParse(await res.json());
  return parsed.success ? parsed.data : null;
}

/**
 * Never render a page and then show an "authentication required" panel inside
 * it (spec 9.1). Layouts call this before returning any markup.
 */
export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  return user;
}
