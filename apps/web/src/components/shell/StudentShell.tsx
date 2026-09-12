import type { ReactNode } from 'react';
import { ThemeToggle } from '@/components/ThemeToggle';
import { requireUser } from '@/lib/session';
import { ShellBrand } from './ShellBrand';
import { StudentSideNav, TabBar } from './TabBar';
import { UserMenu } from './UserMenu';

export async function StudentShell({ title, children }: { title: string; children: ReactNode }) {
  // Memoised by getSessionUser, so this shares the layout's /auth/me call.
  const user = await requireUser();

  return (
    <div className="flex h-dvh overflow-hidden bg-bg">
      {/* Replaces the tab bar from lg up rather than centring a phone column on
          a desktop screen. Same destinations, same order. */}
      <aside className="hidden w-56 shrink-0 flex-col gap-3 border-r border-border bg-surface-2 p-3 pt-[calc(0.75rem+var(--safe-t))] lg:flex">
        <ShellBrand />
        <StudentSideNav />
      </aside>

      <div className="grid min-w-0 flex-1 grid-rows-[auto_1fr_auto] overflow-hidden">
        <header className="flex items-center justify-between gap-3 border-b border-border px-4 pb-3 pt-[calc(0.75rem+var(--safe-t))] lg:px-8">
          <h1 className="min-w-0 flex-1 truncate font-display text-title text-ink">{title}</h1>
          <ThemeToggle />
          <UserMenu user={user} />
        </header>

        <main id="main" className="overflow-y-auto overscroll-contain px-4 py-4 lg:px-8 lg:py-6">
          <div className="mx-auto w-full max-w-5xl">{children}</div>
        </main>

        <TabBar />
      </div>
    </div>
  );
}
