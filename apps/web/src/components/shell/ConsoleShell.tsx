import { Menu } from 'lucide-react';
import type { ReactNode } from 'react';
import { ThemeToggle } from '@/components/ThemeToggle';
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { requireUser } from '@/lib/session';
import { ShellBrand } from './ShellBrand';
import { SideNav, type NavItem } from './SideNav';
import { UserMenu } from './UserMenu';

export async function ConsoleShell({
  items,
  title,
  context,
  children,
}: {
  items: readonly NavItem[];
  title: string;
  context: ReactNode;
  children: ReactNode;
}) {
  // Memoised by getSessionUser, so this shares the layout's /auth/me call.
  const user = await requireUser();

  const nav = (
    <div className="flex flex-col gap-3">
      <ShellBrand />
      {context}
      <SideNav items={items} />
    </div>
  );

  return (
    <div className="min-h-dvh bg-bg lg:grid lg:grid-cols-[14rem_1fr]">
      <aside className="hidden border-r border-border bg-surface-2 p-3 lg:block lg:sticky lg:top-0 lg:h-dvh lg:overflow-y-auto">
        {nav}
      </aside>

      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-border bg-bg px-4 py-3 lg:px-8">
          <Sheet>
            <SheetTrigger
              aria-label="Open navigation"
              className="grid size-11 place-items-center rounded-control text-ink-2 hover:bg-surface-2 lg:hidden"
            >
              <Menu className="size-5" aria-hidden />
            </SheetTrigger>
            <SheetContent side="left" className="w-64 bg-surface-2 p-3">
              <SheetTitle className="sr-only">Navigation</SheetTitle>
              {nav}
            </SheetContent>
          </Sheet>

          <h1 className="min-w-0 flex-1 truncate font-display text-title text-ink">{title}</h1>
          <ThemeToggle />
          <UserMenu user={user} />
        </header>

        {/* Capped so a table does not run the full width of a 27-inch display. */}
        <main id="main" className="mx-auto w-full min-w-0 max-w-7xl flex-1 px-4 py-5 lg:px-8 lg:py-6">
          {children}
        </main>
      </div>
    </div>
  );
}
