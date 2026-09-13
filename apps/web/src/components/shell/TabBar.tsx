'use client';

import { Bell, CalendarDots, House, QrCode, User, Users } from '@phosphor-icons/react/ssr';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/cn';
import { ICON_WEIGHT } from '@/lib/icons';
import { UNREAD_CAP } from '@/lib/page-size';
import { activeNavHref } from '@/lib/routing';
import { SideNav } from './SideNav';

// One list behind both student navigations: the phone's tab bar and the
// desktop sidebar cannot drift into offering different destinations.
const TABS = [
  { href: '/home', label: 'Home', icon: House },
  { href: '/clubs', label: 'Clubs', icon: Users },
  { href: '/events', label: 'Events', icon: CalendarDots },
  { href: '/me/notifications', label: 'Inbox', icon: Bell },
  { href: '/me/qr', label: 'My QR', icon: QrCode },
  { href: '/me', label: 'Me', icon: User },
] as const;

const INBOX = '/me/notifications';
const HREFS = TABS.map((t) => t.href);

/**
 * The count came from one page of unread rows, so a full page means "at least
 * this many" and the badge says so rather than reporting the page size as a
 * total.
 */
function badgeText(unread: number): string {
  return unread >= UNREAD_CAP ? `${UNREAD_CAP - 1}+` : String(unread);
}

/** Phone and small-tablet navigation. Hidden once the sidebar takes over. */
export function TabBar({ unread = 0 }: { unread?: number }) {
  const pathname = usePathname();
  const current = activeNavHref(pathname, HREFS);

  return (
    <nav
      aria-label="Sections"
      className="grid grid-cols-6 border-t border-border bg-surface pb-[var(--safe-b)] lg:hidden"
    >
      {TABS.map(({ href, label, icon: Icon }) => {
        const active = href === current;
        const badge = href === INBOX && unread > 0;
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'relative flex min-h-14 flex-col items-center justify-center gap-0.5 text-label',
              active ? 'font-semibold text-primary' : 'text-ink-3',
            )}
          >
            {active ? (
              <span className="absolute inset-x-[22%] top-0 h-0.5 rounded-b bg-primary" aria-hidden />
            ) : null}
            <span className="relative">
              <Icon size={20} weight={ICON_WEIGHT} aria-hidden />
              {badge ? (
                <span
                  aria-hidden
                  className="tabular absolute -right-2.5 -top-1.5 min-w-4 rounded-full bg-primary px-1 text-center text-[10px] font-semibold leading-4 text-primary-fg"
                >
                  {badgeText(unread)}
                </span>
              ) : null}
            </span>
            {label}
            {badge ? <span className="sr-only">{badgeText(unread)} unread</span> : null}
          </Link>
        );
      })}
    </nav>
  );
}

/** The same destinations as a desktop sidebar. */
export function StudentSideNav({ unread = 0 }: { unread?: number }) {
  return (
    <SideNav
      items={TABS.map(({ href, label, icon: Icon }) => ({
        href,
        label,
        icon: <Icon size={16} weight={ICON_WEIGHT} className="shrink-0" aria-hidden />,
        ...(href === INBOX && unread > 0
          ? {
              trailing: (
                <span className="tabular rounded-full bg-primary px-1.5 text-label font-semibold text-primary-fg">
                  <span aria-hidden>{badgeText(unread)}</span>
                  <span className="sr-only">{badgeText(unread)} unread</span>
                </span>
              ),
            }
          : {}),
      }))}
    />
  );
}
