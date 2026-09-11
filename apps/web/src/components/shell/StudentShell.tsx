import type { ReactNode } from 'react';
import { ThemeToggle } from '@/components/ThemeToggle';
import { TabBar } from './TabBar';

export function StudentShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="grid h-dvh grid-rows-[auto_1fr_auto] overflow-hidden bg-bg">
      <header className="flex items-center justify-between gap-3 border-b border-border px-4 pb-3 pt-[calc(0.75rem+var(--safe-t))]">
        <h1 className="font-display text-title text-ink">{title}</h1>
        <ThemeToggle />
      </header>

      <main id="main" className="overflow-y-auto overscroll-contain px-4 py-4">
        {children}
      </main>

      <TabBar />
    </div>
  );
}
