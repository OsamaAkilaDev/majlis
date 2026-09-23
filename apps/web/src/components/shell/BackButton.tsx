'use client';

import { CaretLeft } from '@phosphor-icons/react/ssr';
import { usePathname, useRouter } from 'next/navigation';
import { ICON_WEIGHT } from '@/lib/icons';
import { backFallback, isTabRoot } from '@/lib/back';
import { useShellSession } from './shell-session';

/**
 * Renders nothing on the three tab roots, where back would leave the app.
 *
 * `router.back()` rather than a computed parent href: the viewer's own history
 * is what they mean by back, and a hierarchy link sends someone who arrived at
 * an event from the inbox to a club they were never looking at.
 *
 * `history.length <= 1` stands in for "back has nothing to go to", the case a
 * notification's deep link produces: the event or club it opens is the only
 * entry this tab has ever had. It is a heuristic, not a proof, since the
 * count belongs to the whole browser tab, not this application: a restored
 * tab or an opener window can hold it above 1 for reasons unrelated to this
 * product. When that happens, `back()` is called on a length that looks
 * sufficient but is not ours, and it lands on whatever real entry sits behind
 * it, an opener page, a stale tab-restore entry, possibly outside this app
 * entirely, not a dead press. The `<= 1` case above it is the one this
 * actually fixes, and it is exact.
 */
export function BackButton() {
  const pathname = usePathname();
  const router = useRouter();
  const { user } = useShellSession();

  if (isTabRoot(pathname)) return null;

  function back() {
    if (window.history.length <= 1) {
      router.push(backFallback(pathname, user));
      return;
    }
    router.back();
  }

  return (
    <button
      type="button"
      onClick={back}
      aria-label="Back"
      className="grid size-11 shrink-0 place-items-center rounded-control text-ink-2 hover:bg-surface-2 hover:text-ink"
    >
      <CaretLeft size={20} weight={ICON_WEIGHT} aria-hidden />
    </button>
  );
}
