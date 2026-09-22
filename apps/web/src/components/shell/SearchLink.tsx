import { MagnifyingGlass } from '@phosphor-icons/react/ssr';
import Link from 'next/link';
import { ICON_WEIGHT } from '@/lib/icons';

/**
 * The way out of the viewer's own events and clubs into the whole university's.
 * A link rather than a button: it is a navigation, so it opens in a new tab,
 * carries a back step, and needs no JavaScript.
 */
export function SearchLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      aria-label={label}
      className="grid size-11 shrink-0 place-items-center rounded-full text-ink-2 transition-colors duration-(--dur) hover:bg-surface-2 hover:text-ink"
    >
      <MagnifyingGlass size={22} weight={ICON_WEIGHT} aria-hidden />
    </Link>
  );
}
