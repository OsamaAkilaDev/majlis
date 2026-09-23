'use client';

import { CaretLeft } from '@phosphor-icons/react/ssr';
import { usePathname, useRouter } from 'next/navigation';
import { ICON_WEIGHT } from '@/lib/icons';
import { isTabRoot } from '@/lib/back';

/**
 * Renders nothing on the three tab roots, where back would leave the app.
 *
 * `router.back()` rather than a computed parent href: the viewer's own history
 * is what they mean by back, and a hierarchy link sends someone who arrived at
 * an event from the inbox to a club they were never looking at.
 */
export function BackButton() {
  const pathname = usePathname();
  const router = useRouter();

  if (isTabRoot(pathname)) return null;

  return (
    <button
      type="button"
      onClick={() => router.back()}
      aria-label="Back"
      className="grid size-11 shrink-0 place-items-center rounded-control text-ink-2 hover:bg-surface-2 hover:text-ink"
    >
      <CaretLeft size={20} weight={ICON_WEIGHT} aria-hidden />
    </button>
  );
}
