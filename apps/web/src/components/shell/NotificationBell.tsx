'use client';

import { Bell } from '@phosphor-icons/react/ssr';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/cn';
import { ICON_WEIGHT } from '@/lib/icons';
import { UNREAD_CAP, cappedCount } from '@/lib/page-size';
import { activeNavHref } from '@/lib/routing';

const INBOX = '/profile/notifications';

/**
 * The inbox, in the header beside the avatar rather than in the tab bar. The
 * unread count is passed in by the shell, which already fetched it on the
 * server, so the badge is right on first paint instead of arriving a frame
 * later.
 */
export function NotificationBell({ unread = 0 }: { unread?: number }) {
  const pathname = usePathname();
  const current = activeNavHref(pathname, [INBOX]) !== null;
  const badge = unread > 0;
  const count = cappedCount(unread, UNREAD_CAP);

  // Round, and lit by a soft teal ground rather than a teal outline. The
  // outline this replaces was two pixels of --primary at the button's edge,
  // which is exactly what :focus-visible draws: the lit state and the
  // keyboard state were the same picture. The avatar beside it is lit the
  // same way, so the two read as one pair.
  return (
    <Link
      href={INBOX}
      aria-label={badge ? `Notifications, ${count} unread` : 'Notifications'}
      aria-current={current ? 'page' : undefined}
      className={cn(
        'relative grid size-11 place-items-center rounded-full transition-colors duration-(--dur)',
        current
          ? 'bg-primary-soft text-primary-soft-fg'
          : 'text-ink-2 hover:bg-surface-2 hover:text-ink',
      )}
    >
      {/* The badge is positioned off the icon, not off the 44px hit area: the
          target is padded well clear of the glyph, so a badge in the button's
          corner lands in the middle of the bell instead of on its shoulder. */}
      <span className="relative">
        <Bell size={20} weight={ICON_WEIGHT} aria-hidden />
        {badge ? (
          <span
            aria-hidden
            className="tabular absolute -right-2.5 -top-1.5 min-w-4 rounded-full bg-primary px-1 text-center text-[10px] font-semibold leading-4 text-primary-fg"
          >
            {count}
          </span>
        ) : null}
      </span>
    </Link>
  );
}
