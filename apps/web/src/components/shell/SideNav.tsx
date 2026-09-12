'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { activeNavHref } from '@/lib/routing';

// icon is a rendered element, not a component reference: a bare component type
// crossing the server-to-client boundary as a prop fails RSC serialization.
export type NavItem = { href: string; label: string; icon: ReactNode };

export function SideNav({ items }: { items: readonly NavItem[] }) {
  const pathname = usePathname();
  // Prefix match, not equality: an event detail or a club page would otherwise
  // light no entry at all and leave the viewer with no sense of place.
  const current = activeNavHref(pathname, items.map((i) => i.href));

  return (
    <nav aria-label="Sections" className="flex flex-col gap-0.5">
      {items.map(({ href, label, icon }) => {
        const active = href === current;
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex min-h-9 items-center gap-2.5 rounded-control px-2.5 py-2 text-sm transition-colors duration-[--dur-fast] ease-[--ease-out]',
              active ? 'bg-primary-soft font-semibold text-primary-soft-fg' : 'text-ink-2 hover:bg-surface hover:text-ink',
            )}
          >
            {icon}
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
