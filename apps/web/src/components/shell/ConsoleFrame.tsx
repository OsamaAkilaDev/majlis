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
 * Everything on a console that must survive a navigation: the sidebar, the
 * phone navigation sheet, and the session the header reads.
 *
 * Rendered by each console's layout, so moving between its pages does not
 * rebuild the navigation or refetch the viewer, and a route's skeleton renders
 * with the console still standing around it.
 *
 * `children` is the page, which renders `ConsoleShell`: its header and main
 * fill the rows below.
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

  /**
   * One screen forces the dark palette whatever the viewer's theme is: the
   * scanner. An operator standing in a lit hall holding a viewfinder needs the
   * surround dark for the feed to read, and needs not to be blinded by a white
   * bar between two people. The use scene decides it, not the toggle.
   *
   * Derived from the path rather than passed down, because the frame now lives
   * in the layout and the page can no longer tell it. Overlays render in a
   * portal on <body> and so keep following the viewer's theme, which is the
   * one seam this leaves, exactly as before.
   */
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
          {/* The hamburger belongs to the frame, not the page: it opens the
              navigation, which the frame owns. */}
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
