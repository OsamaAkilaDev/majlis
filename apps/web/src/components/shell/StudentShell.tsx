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

      {/* Phone only, and load-bearing: the dock floats over this scroll area,
          so without the clearance the last row of every student screen sits
          under it and cannot be reached.

          The number is derived, not guessed. The dock is 68px tall (a 56px tab
          row plus 6px of padding either side), sits 1rem above the safe-area
          inset, and wants a 1rem breath above it: 68 + 16 + 16 = 100px, plus
          whatever the device reserves at the bottom edge. The sidebar replaces
          the dock from lg up, where the padding drops back to the normal rhythm. */}
      <main
        id="main"
        className="overflow-y-auto overscroll-contain px-4 pt-4 pb-[calc(7rem+var(--safe-b))] lg:px-8 lg:py-6 lg:pb-6"
      >
        {/* min-h-full, never h-full. A screen that centres itself needs a
            height to centre against, but a fixed one caps the scroll area at
            one viewport: main then reports nothing to scroll while the content
            spills out underneath the dock. The inbox and the certificate list
            were both doing exactly that. */}
        <div className="mx-auto min-h-full w-full max-w-5xl">{children}</div>
      </main>
    </>
  );
}
