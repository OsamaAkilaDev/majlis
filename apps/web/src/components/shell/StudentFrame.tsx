'use client';

import type { ReactNode } from 'react';
import { ShellSessionProvider, type ShellSession } from './shell-session';
import { ShellBrand } from './ShellBrand';
import { StudentSideNav, TabBar } from './TabBar';

/**
 * Everything on the student shell that must survive a navigation: the desktop
 * sidebar, the phone dock, and the session the header reads.
 *
 * Rendered by `(student)/layout.tsx`, so React keeps it mounted while the page
 * inside it changes. That is what lets the dock's pill travel between tabs,
 * and what keeps the navigation on screen while a route's skeleton is up.
 *
 * `children` is the page, which renders `StudentShell`: its header and main
 * fill the two rows of the grid below.
 */
export function StudentFrame({
  session,
  children,
}: {
  session: ShellSession;
  children: ReactNode;
}) {
  return (
    <ShellSessionProvider value={session}>
      <div className="flex h-dvh overflow-hidden bg-bg">
        {/* Replaces the dock from lg up rather than centring a phone column on
            a desktop screen. Same destinations, same order. */}
        <aside className="hidden w-56 shrink-0 flex-col gap-3 border-r border-border bg-surface-2 p-3 pt-[calc(0.75rem+var(--safe-t))] lg:flex">
          <ShellBrand />
          <StudentSideNav />
        </aside>

        {/* relative, because the dock is positioned over the scroll area
            rather than taking a row of its own. */}
        <div className="relative grid min-w-0 flex-1 grid-rows-[auto_1fr] overflow-hidden">
          {children}
          <TabBar />
        </div>
      </div>
    </ShellSessionProvider>
  );
}
