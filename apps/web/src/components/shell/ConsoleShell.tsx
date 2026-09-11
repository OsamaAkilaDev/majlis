import { Menu } from 'lucide-react';
import type { ReactNode } from 'react';
import { ThemeToggle } from '@/components/ThemeToggle';
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { SideNav, type NavItem } from './SideNav';

export function ConsoleShell({
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
  return (
    <div className="min-h-dvh bg-bg lg:grid lg:grid-cols-[13rem_1fr]">
      <aside className="hidden border-r border-border bg-surface-2 p-3 lg:flex lg:flex-col lg:gap-3">
        {context}
        <SideNav items={items} />
      </aside>

      <div className="flex min-w-0 flex-col">
        <header className="flex items-center gap-3 border-b border-border px-4 py-3 lg:px-6">
          <Sheet>
            <SheetTrigger
              aria-label="Open navigation"
              className="grid size-11 place-items-center rounded-control text-ink-2 hover:bg-surface-2 lg:hidden"
            >
              <Menu className="size-5" aria-hidden />
            </SheetTrigger>
            <SheetContent side="left" className="w-64 bg-surface-2 p-3">
              <SheetTitle className="sr-only">Navigation</SheetTitle>
              <div className="flex flex-col gap-3">
                {context}
                <SideNav items={items} />
              </div>
            </SheetContent>
          </Sheet>

          <h1 className="min-w-0 flex-1 truncate font-display text-title text-ink">{title}</h1>
          <ThemeToggle />
        </header>

        <main id="main" className="min-w-0 flex-1 px-4 py-5 lg:px-6">
          {children}
        </main>
      </div>
    </div>
  );
}
