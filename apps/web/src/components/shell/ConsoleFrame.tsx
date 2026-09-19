'use client';

import { List } from '@phosphor-icons/react/ssr';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { cn } from '@/lib/cn';
import { ICON_WEIGHT } from '@/lib/icons';
import { ShellSessionProvider, type ShellSession } from './shell-session';
import { ShellBrand } from './ShellBrand';
import { SideNav, type NavItem } from './SideNav';

/**
 * Rendered by each console's layout, so moving between pages does not rebuild
 * the navigation or refetch the viewer. `children` is the page, which renders
 * `ConsoleShell`.
 */
export function ConsoleFrame({
  items,
  session,
  children,
}: {
  items: readonly NavItem[];
  session: ShellSession;
  children: ReactNode;
}) {
  const pathname = usePathname();

  // The scanner forces dark whatever the viewer's theme is: a viewfinder in a
  // lit hall needs a dark surround. Derived from the path because the frame
  // lives in the layout and the page cannot tell it. Overlays portal to
  // <body> and so keep following the viewer's theme, which is the one seam.
  const dark = pathname.endsWith('/scan');

  const nav = (
    <div className="flex flex-col gap-3">
      <ShellBrand />
      <SideNav items={items} />
    </div>
  );

  return (
    <ShellSessionProvider value={session}>
      <div className={cn('min-h-dvh bg-bg lg:grid lg:grid-cols-[14rem_1fr]', dark && 'dark')}>
        <aside className="hidden border-r border-border bg-surface-2 p-3 lg:block lg:sticky lg:top-0 lg:h-dvh lg:overflow-y-auto">
          {nav}
        </aside>

        <div className="flex min-w-0 flex-col">

          <Sheet>
            <SheetTrigger
              aria-label="Open navigation"
              className="absolute left-4 top-3 z-30 grid size-11 place-items-center rounded-control text-ink-2 hover:bg-surface-2 lg:hidden"
            >
              <List size={20} weight={ICON_WEIGHT} aria-hidden />
            </SheetTrigger>
            <SheetContent side="left" className="w-64 bg-surface-2 p-3">
              <SheetTitle className="sr-only">Navigation</SheetTitle>
              {nav}
            </SheetContent>
          </Sheet>

          {children}
        </div>
      </div>
    </ShellSessionProvider>
  );
}
