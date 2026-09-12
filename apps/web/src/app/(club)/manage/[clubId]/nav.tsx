import { CalendarDots, Scan, Shield, SquaresFour, Trophy, Users } from '@phosphor-icons/react/ssr';
import { ICON_WEIGHT } from '@/lib/icons';

const icon = { size: 16, weight: ICON_WEIGHT, className: 'shrink-0', 'aria-hidden': true } as const;

export function clubNav(clubId: string) {
  const base = `/manage/${clubId}`;
  return [
    { href: `${base}/overview`, label: 'Overview', icon: <SquaresFour {...icon} /> },
    { href: `${base}/members`, label: 'Members', icon: <Users {...icon} /> },
    { href: `${base}/team`, label: 'Team', icon: <Shield {...icon} /> },
    { href: `${base}/events`, label: 'Events', icon: <CalendarDots {...icon} /> },
    { href: `${base}/scan`, label: 'Scan', icon: <Scan {...icon} /> },
    { href: `${base}/certificates`, label: 'Certificates', icon: <Trophy {...icon} /> },
  ] as const;
}
