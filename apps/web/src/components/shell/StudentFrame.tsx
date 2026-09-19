'use client';

import type { ReactNode } from 'react';
import { ShellSessionProvider, type ShellSession } from './shell-session';
import { ShellBrand } from './ShellBrand';
import { StudentSideNav, TabBar } from './TabBar';

/**
 * Rendered by `(student)/layout.tsx` so React keeps it mounted while the page
 * changes, which is what lets the dock's pill travel rather than blink.
 * `children` is the page, which renders `StudentShell`.
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

        <aside className="hidden w-56 shrink-0 flex-col gap-3 border-r border-border bg-surface-2 p-3 pt-[calc(0.75rem+var(--safe-t))] lg:flex">
          <ShellBrand />
          <StudentSideNav />
        </aside>

        {/* relative: the dock is positioned over the scroll area, not given a
            row of its own. */}
        <div className="relative grid min-w-0 flex-1 grid-rows-[auto_1fr] overflow-hidden">
          {children}
          <TabBar />
        </div>
      </div>
    </ShellSessionProvider>
  );
}
