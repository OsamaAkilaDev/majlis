import type { ReactNode } from 'react';
import { ThemeToggle } from '@/components/ThemeToggle';
import { requireUser } from '@/lib/session';
import { TabBar } from './TabBar';
import { UserMenu } from './UserMenu';

export async function StudentShell({ title, children }: { title: string; children: ReactNode }) {
  // Memoised by getSessionUser, so this shares the layout's /auth/me call.
  const user = await requireUser();

  return (
    <div className="grid h-dvh grid-rows-[auto_1fr_auto] overflow-hidden bg-bg">
      <header className="flex items-center justify-between gap-3 border-b border-border px-4 pb-3 pt-[calc(0.75rem+var(--safe-t))]">
        <h1 className="min-w-0 flex-1 truncate font-display text-title text-ink">{title}</h1>
        <ThemeToggle />
        <UserMenu user={user} />
      </header>

      <main id="main" className="overflow-y-auto overscroll-contain px-4 py-4">
        {children}
      </main>

      <TabBar />
    </div>
  );
}
