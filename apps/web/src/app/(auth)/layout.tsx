import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { landingFor } from '@/lib/routing';
import { getSessionUser } from '@/lib/session';

export default async function AuthLayout({ children }: { children: ReactNode }) {
  const user = await getSessionUser();
  if (user) redirect(landingFor(user));

  return (
    <main id="main" className="lattice grid min-h-dvh place-items-center px-5 py-10">
      <div className="w-full max-w-sm">{children}</div>
    </main>
  );
}
