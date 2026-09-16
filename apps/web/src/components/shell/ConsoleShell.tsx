'use client';

import type { ReactNode } from 'react';
import { ThemeToggle } from '@/components/ThemeToggle';
import { ProfileButton } from './ProfileButton';
import { useShellSession } from './shell-session';

/**
 * A console's header and content area: the part that belongs to a page rather
 * than to the console around it.
 *
 * Deliberately not async, for the same reason `StudentShell` is not. A route's
 * `loading.tsx` renders this header the instant a link is clicked, and a shell
 * that awaited `/auth/me` would suspend inside the fallback and put the
 * blocking navigation back.
 *
 * The `context` prop it used to take was `null` at every call site and has
 * been dropped. `dark` has moved to `ConsoleFrame`, which derives it from the
 * path, because the frame now lives in the layout where the page cannot reach.
 */
export function ConsoleShell({ title, children }: { title: string; children: ReactNode }) {
  const { user } = useShellSession();

  return (
    <>
      {/* pl-14 below lg leaves room for the hamburger, which the frame pins to
          the top left because it opens navigation the frame owns. */}
      <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-border bg-bg py-3 pl-14 pr-4 lg:px-8">
        <h1 className="min-w-0 flex-1 truncate font-display text-title text-ink">{title}</h1>
        {/* The consoles keep the header toggle. A desktop operator flips the
            theme far more often than they visit /profile, and unlike the phone
            there is room for it beside the title. */}
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
