import { Buildings, CalendarDots, Shield, User, Users } from '@phosphor-icons/react/ssr';
import { ICON_WEIGHT } from '@/lib/icons';

const icon = { size: 16, weight: ICON_WEIGHT, className: 'shrink-0', 'aria-hidden': true } as const;

export const ADMIN_NAV = [
  { href: '/admin/users', label: 'Users', icon: <User {...icon} /> },
  { href: '/admin/departments', label: 'Departments', icon: <Buildings {...icon} /> },
  { href: '/admin/clubs', label: 'Clubs', icon: <Users {...icon} /> },
  { href: '/admin/events', label: 'Events', icon: <CalendarDots {...icon} /> },
  { href: '/admin/audit', label: 'Audit', icon: <Shield {...icon} /> },
] as const;
