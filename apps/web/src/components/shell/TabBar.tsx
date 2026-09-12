'use client';

import { CalendarDays, House, QrCode, User, Users } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/cn';
import { activeTabHref } from '@/lib/routing';

const TABS = [
  { href: '/home', label: 'Home', icon: House },
  { href: '/clubs', label: 'Clubs', icon: Users },
  { href: '/events', label: 'Events', icon: CalendarDays },
  { href: '/me/qr', label: 'My QR', icon: QrCode },
  { href: '/me', label: 'Me', icon: User },
] as const;

export function TabBar() {
  const pathname = usePathname();
  const current = activeTabHref(pathname, TABS.map((t) => t.href));

  return (
    <nav
      aria-label="Sections"
      className="grid grid-cols-5 border-t border-border bg-surface pb-[var(--safe-b)]"
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
            <Icon className="size-5" aria-hidden />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
