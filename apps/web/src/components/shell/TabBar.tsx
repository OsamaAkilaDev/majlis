'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/cn';
import { ICON_WEIGHT } from '@/lib/icons';
import { activeNavHref } from '@/lib/routing';
import { SideNav } from './SideNav';
import { STUDENT_NAV, STUDENT_TABS as TABS } from './student-nav';

const HREFS = TABS.map((t) => t.href);

/**
 * Rendered by the layout, never a page: it must survive navigation for the
 * pill to travel, and stay up during a `loading.tsx` fallback.
 *
 * Positioned over the scroll area rather than sitting in the grid, so
 * `StudentShell` pads the bottom of `main` to clear it.
 */
export function TabBar() {
  const pathname = usePathname();
  const current = activeNavHref(pathname, HREFS);
  const index = TABS.findIndex((t) => t.href === current);

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 lg:hidden">
      {/* The page fades into its own background before reaching the
          translucent dock, so what shows through is not half a legible row. */}
      <div aria-hidden className="h-28 bg-gradient-to-t from-bg from-30% to-transparent" />

      <nav
        aria-label="Sections"
        className="pointer-events-auto absolute inset-x-4 bottom-[calc(1rem+var(--safe-b))] grid grid-cols-4 rounded-full border border-border bg-surface/80 p-1.5 shadow-[var(--shadow-float)] backdrop-blur-xl"
      >
        {/* Hidden outright when no tab is lit: under /profile the avatar is
            current, and a pill parked on Home would contradict it. */}
        {index >= 0 ? (
          <span
            aria-hidden
            style={{ '--i': index } as React.CSSProperties}
            className="absolute inset-y-1.5 left-1.5 w-[calc((100%-0.75rem)/4)] translate-x-[calc(var(--i)*100%)] rounded-full bg-primary transition-transform duration-(--dur) ease-(--ease-out) motion-reduce:transition-none"
          />
        ) : null}

        {TABS.map(({ href, label, icon: Icon }) => {
          const active = href === current;
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                // Not text-label: its 0.07em tracking is for uppercase eyebrows
                // and pulls a four-letter word apart.
                'relative z-10 flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-full text-[0.6875rem] leading-none tracking-normal transition-colors duration-(--dur) ease-(--ease-out)',
                active ? 'font-semibold text-primary-fg' : 'text-ink-3 hover:text-ink-2',
              )}
            >
              <Icon size={22} weight={ICON_WEIGHT} aria-hidden />
              {label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

/** The same destinations as a desktop sidebar. */
export function StudentSideNav() {
  return <SideNav items={STUDENT_NAV} />;
}
