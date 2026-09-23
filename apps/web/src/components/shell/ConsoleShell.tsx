'use client';

import type { ReactNode } from 'react';
import { ThemeToggle } from '@/components/ThemeToggle';
import { BackButton } from './BackButton';
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
      {/* pl-16 below lg clears the frame's hamburger: it sits at left-4 with a
          size-11 (44px) hit area, so its own box ends at 60px. pl-14 (56px)
          left BackButton's box overlapping it by 4px; pl-16 (64px) clears it. */}
      <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-border bg-bg py-3 pl-16 pr-4 lg:px-8">
        <BackButton />
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
