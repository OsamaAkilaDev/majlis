'use client';

import { CalendarDots, House, QrCode, User, Users } from '@phosphor-icons/react/ssr';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/cn';
import { ICON_WEIGHT } from '@/lib/icons';
import { activeNavHref } from '@/lib/routing';
import { SideNav } from './SideNav';

// One list behind both student navigations: the phone's tab bar and the
// desktop sidebar cannot drift into offering different destinations.
const TABS = [
  { href: '/home', label: 'Home', icon: House },
  { href: '/clubs', label: 'Clubs', icon: Users },
  { href: '/events', label: 'Events', icon: CalendarDots },
  { href: '/me/qr', label: 'My QR', icon: QrCode },
  { href: '/me', label: 'Me', icon: User },
] as const;

const HREFS = TABS.map((t) => t.href);

/** Phone and small-tablet navigation. Hidden once the sidebar takes over. */
export function TabBar() {
  const pathname = usePathname();
  const current = activeNavHref(pathname, HREFS);

  return (
    <nav
      aria-label="Sections"
      className="grid grid-cols-5 border-t border-border bg-surface pb-[var(--safe-b)] lg:hidden"
    >
      {TABS.map(({ href, label, icon: Icon }) => {
        const active = href === current;
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
            <Icon size={20} weight={ICON_WEIGHT} aria-hidden />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

/** The same destinations as a desktop sidebar. */
export function StudentSideNav() {
  return (
    <SideNav
      items={TABS.map(({ href, label, icon: Icon }) => ({
        href,
        label,
        icon: <Icon size={16} weight={ICON_WEIGHT} className="shrink-0" aria-hidden />,
      }))}
    />
  );
}
