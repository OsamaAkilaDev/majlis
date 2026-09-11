import { CalendarDays, LayoutGrid, ScanLine, Shield, Trophy, Users } from 'lucide-react';

const iconClass = 'size-4 shrink-0';

export function clubNav(clubId: string) {
  const base = `/manage/${clubId}`;
  return [
    { href: `${base}/overview`, label: 'Overview', icon: <LayoutGrid className={iconClass} aria-hidden /> },
    { href: `${base}/members`, label: 'Members', icon: <Users className={iconClass} aria-hidden /> },
    { href: `${base}/team`, label: 'Team', icon: <Shield className={iconClass} aria-hidden /> },
    { href: `${base}/events`, label: 'Events', icon: <CalendarDays className={iconClass} aria-hidden /> },
    { href: `${base}/scan`, label: 'Scan', icon: <ScanLine className={iconClass} aria-hidden /> },
    { href: `${base}/certificates`, label: 'Certificates', icon: <Trophy className={iconClass} aria-hidden /> },
  ] as const;
}
