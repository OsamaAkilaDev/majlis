'use client';

import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';

/**
 * Appears only once something is dirty, and says how much. An always-present
 * Save button on a page that reads as a page claims there is something to do
 * when there is not.
 *
 * Sticky to the foot of the scroll area rather than fixed to the viewport, so
 * it cannot sit over the last row of a short screen.
 */
export function SaveBar({
  count,
  busy,
  onDiscard,
  onSave,
  blocked,
  children,
}: {
  count: number;
  busy?: boolean;
  onDiscard: () => void;
  onSave: () => void;
  /** True keeps Save unpressable, for a reason `children` is carrying. */
  blocked?: boolean;
  /** Anything the save itself requires, such as spec 6.1's override reason. */
  children?: ReactNode;
}) {
  if (count === 0) return null;

  return (
    <div
      role="status"
      className="sticky bottom-0 z-10 -mx-4 mt-6 flex flex-wrap items-center gap-3 border-t border-border bg-surface px-4 py-3 shadow-[0_-8px_24px_-18px_rgba(28,23,19,.5)] lg:-mx-8 lg:px-8"
    >
      <b className="text-sm text-ink">
        {count} {count === 1 ? 'change' : 'changes'}
      </b>
      {children}
      <div className="ml-auto flex gap-2">
        <Button variant="ghost" size="sm" onClick={onDiscard} disabled={busy}>
          Discard
        </Button>
        <Button size="sm" onClick={onSave} disabled={busy || blocked}>
          Save
        </Button>
      </div>
    </div>
  );
}
