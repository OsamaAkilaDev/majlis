'use client';

import { CalendarDots, House, QrCode, Users } from '@phosphor-icons/react/ssr';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/cn';
import { ICON_WEIGHT } from '@/lib/icons';
import { activeNavHref } from '@/lib/routing';
import { SideNav } from './SideNav';

// One list behind both student navigations: the phone's dock and the desktop
// sidebar cannot drift into offering different destinations.
//
// The inbox and the profile are deliberately absent. Both are reached from
// the header at every width, the bell and the avatar, so a screen under
// /profile lights no tab at all and the avatar carries the current state.
const TABS = [
  { href: '/home', label: 'Home', icon: House },
  { href: '/clubs', label: 'Clubs', icon: Users },
  { href: '/events', label: 'Events', icon: CalendarDots },
  { href: '/profile/qr', label: 'QR', icon: QrCode },
] as const;

const HREFS = TABS.map((t) => t.href);

/**
 * Phone and small-tablet navigation: a dock inset from all three edges with
 * the page scrolling under it.
 *
 * Rendered by the student layout, not by a page, for two reasons. It survives
 * navigation, which is the only way the pill can travel rather than blink from
 * one tab to another; and it stays on screen while a `loading.tsx` fallback is
 * up, so a tap never makes the navigation disappear.
 *
 * Because it is positioned over the scroll area rather than sitting in the
 * grid, `StudentShell` pads the bottom of `main` to clear it.
 */
export function TabBar() {
  const pathname = usePathname();
  const current = activeNavHref(pathname, HREFS);
  const index = TABS.findIndex((t) => t.href === current);

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 lg:hidden">
      {/* Content passing under a translucent dock reads as noise behind glass.
          The page fades into its own background first, so what shows through
          is a suggestion of the list rather than half a legible row. */}
      <div aria-hidden className="h-28 bg-gradient-to-t from-bg from-30% to-transparent" />

      <nav
        aria-label="Sections"
        className="pointer-events-auto absolute inset-x-4 bottom-[calc(1rem+var(--safe-b))] grid grid-cols-4 rounded-full border border-border bg-surface/80 p-1.5 shadow-[var(--shadow-float)] backdrop-blur-xl"
      >
        {/* One pill that travels, rather than four backgrounds switching off
            and on. The four tabs are equal width, so the arithmetic is exact.
            Hidden outright when no tab is lit: under /profile the avatar is
            current instead, and a pill parked on Home would contradict it. */}
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
                // The glyph leads and the word is a caption under it: at a
                // glance on a phone the icon is what is read, so it takes the
                // room. Not text-label, whose 0.07em tracking is meant for
                // uppercase eyebrows and pulls a four-letter word apart.
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
