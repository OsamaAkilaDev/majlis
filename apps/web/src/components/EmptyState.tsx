import type { ReactNode } from 'react';

export function EmptyState({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="lattice flex flex-col items-center gap-4 rounded-card border border-dashed border-border-control px-6 py-10 text-center">
      <h2 className="font-display text-display text-ink">{title}</h2>
      {action}
    </div>
  );
}
