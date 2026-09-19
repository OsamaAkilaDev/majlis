import { CalendarDots, House, QrCode, Users } from '@phosphor-icons/react/ssr';
import { ICON_WEIGHT } from '@/lib/icons';
import type { NavItem } from './SideNav';

/**
 * One list behind every student navigation: the dock, the desktop sidebar, and
 * the platform rail a club workspace keeps. Its own module, with no
 * 'use client', so a Server Component can render the icons into NavItems.
 *
 * The inbox and profile are deliberately absent: both live in the header, so a
 * screen under /profile lights no tab and the avatar carries the current state
 * instead.
 */
export const STUDENT_TABS = [
  { href: '/home', label: 'Home', icon: House },
  { href: '/clubs', label: 'Clubs', icon: Users },
  { href: '/events', label: 'Events', icon: CalendarDots },
  { href: '/profile/qr', label: 'QR', icon: QrCode },
] as const;

export const STUDENT_NAV: NavItem[] = STUDENT_TABS.map(({ href, label, icon: Icon }) => ({
  href,
  label,
  icon: <Icon size={16} weight={ICON_WEIGHT} className="shrink-0" aria-hidden />,
}));
