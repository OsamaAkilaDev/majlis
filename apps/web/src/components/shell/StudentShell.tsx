'use client';

import type { ReactNode } from 'react';
import { NotificationBell } from './NotificationBell';
import { ProfileButton } from './ProfileButton';
import { useShellSession } from './shell-session';

/**
 * The header and the scroll area: the part of the student shell that belongs
 * to a page rather than to the shell around it.
 *
 * Deliberately not async. It reads the viewer from the layout's context
 * instead of awaiting `/auth/me`, so a route's `loading.tsx` can render this
 * exact header the instant a link is tapped. An async shell here would suspend
 * inside the Suspense fallback and put the blocking navigation straight back.
 *
 * It returns two siblings, not a wrapper: they are the two rows of the grid
 * `StudentFrame` sets up, with the dock positioned over the second.
 */
export function StudentShell({ title, children }: { title: string; children: ReactNode }) {
  const { user, unread } = useShellSession();

  return (
    <>
      <header className="flex items-center gap-1 border-b border-border px-4 pb-3 pt-[calc(0.75rem+var(--safe-t))] lg:px-8">
        <h1 className="min-w-0 flex-1 truncate pr-2 font-display text-title text-ink">{title}</h1>
        <NotificationBell unread={unread} />
        <ProfileButton user={user} />
      </header>

      {/* pb-28 clears the floating dock. It is not decoration: without it the
          last row of every list on every student screen sits under the dock
          and cannot be reached. The sidebar replaces the dock at lg, so the
          padding goes with it. */}
      <main
        id="main"
        className="overflow-y-auto overscroll-contain px-4 py-4 pb-28 lg:px-8 lg:py-6"
      >
        {/* h-full so a screen that wants to centre itself in the viewport has a
            definite height to centre against. Block children do not stretch, so
            every other page is unaffected. */}
        <div className="mx-auto h-full w-full max-w-5xl">{children}</div>
      </main>
    </>
  );
}
