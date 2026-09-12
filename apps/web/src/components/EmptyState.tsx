import type { ReactNode } from 'react';

export function EmptyState({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="lattice flex flex-col items-center gap-4 rounded-card border border-dashed border-border-control px-6 py-10 text-center">
      {/* text-title, not text-display: an empty state outshouting the page's
          own h1 inverts the hierarchy, which only shows up at desktop width. */}
      <h2 className="font-display text-title text-ink">{title}</h2>
      {action}
    </div>
  );
}
