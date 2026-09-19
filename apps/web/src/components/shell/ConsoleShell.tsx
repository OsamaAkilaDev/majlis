'use client';

import type { ReactNode } from 'react';
import { ThemeToggle } from '@/components/ThemeToggle';
import { ProfileButton } from './ProfileButton';
import { useShellSession } from './shell-session';

/**
 * Deliberately not async: `loading.tsx` renders this header the instant a link
 * is clicked, and a shell that awaited `/auth/me` would suspend inside the
 * fallback and put the blocking navigation back.
 */
export function ConsoleShell({ title, children }: { title: string; children: ReactNode }) {
  const { user } = useShellSession();

  return (
    <>
      {/* pl-14 below lg leaves room for the frame's hamburger. */}
      <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-border bg-bg py-3 pl-14 pr-4 lg:px-8">
        <h1 className="min-w-0 flex-1 truncate font-display text-title text-ink">{title}</h1>

        <ThemeToggle />
        <ProfileButton user={user} />
      </header>

      {/* Capped so a table does not run the full width of a 27-inch display. */}
      <main id="main" className="mx-auto w-full min-w-0 max-w-7xl flex-1 px-4 py-5 lg:px-8 lg:py-6">
        {children}
      </main>
    </>
  );
}
