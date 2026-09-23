'use client';

import type { ReactNode } from 'react';
import { BackButton } from './BackButton';
import { NotificationBell } from './NotificationBell';
import { ProfileButton } from './ProfileButton';
import { useShellSession } from './shell-session';

/**
 * Deliberately not async: it reads the viewer from context rather than
 * awaiting `/auth/me`, or `loading.tsx` would suspend and put the blocking
 * navigation back. Returns two siblings, not a wrapper: they are the two rows
 * of `StudentFrame`'s grid.
 */
export function StudentShell({
  title,
  action,
  children,
}: {
  title: string;
  /** Rendered between the title and the bell. One control, not a toolbar. */
  action?: ReactNode;
  children: ReactNode;
}) {
  const { user, unread } = useShellSession();

  return (
    <>
      <header className="flex items-center gap-1 border-b border-border px-4 pb-3 pt-[calc(0.75rem+var(--safe-t))] lg:px-8">
        <BackButton />
        {/* Smaller below sm: at the full title ramp a club's name and the two
            44px controls beside it do not fit across 320px, and the name is
            the half that loses. */}
        <h1 className="min-w-0 flex-1 truncate pr-2 font-display text-h1 text-ink sm:text-title">
          {title}
        </h1>
        {action}
        <NotificationBell unread={unread} />
        <ProfileButton user={user} />
      </header>

      {/* Load-bearing: the dock floats over this scroll area, so without the
          clearance the last row of every student screen is unreachable.
          68px dock + 16px inset + 16px breath = 100px, plus the device's own
          bottom inset. */}
      <main
        id="main"
        className="overflow-y-auto overscroll-contain px-4 pt-4 pb-[calc(7rem+var(--safe-b))] lg:px-8 lg:py-6 lg:pb-6"
      >
        {/* min-h-full, never h-full: a fixed height caps the scroll area at one
            viewport, so main reports nothing to scroll while the content spills
            under the dock. */}
        <div className="mx-auto min-h-full w-full max-w-5xl">{children}</div>
      </main>
    </>
  );
}
