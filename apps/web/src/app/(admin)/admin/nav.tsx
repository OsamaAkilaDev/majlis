import {
  Buildings,
  CalendarDots,
  DownloadSimple,
  Shield,
  SquaresFour,
  User,
  Users,
} from '@phosphor-icons/react/ssr';
import { ICON_WEIGHT } from '@/lib/icons';

const icon = { size: 16, weight: ICON_WEIGHT, className: 'shrink-0', 'aria-hidden': true } as const;

export const ADMIN_NAV = [
  { href: '/admin/metrics', label: 'Metrics', icon: <SquaresFour {...icon} /> },
  { href: '/admin/users', label: 'Users', icon: <User {...icon} /> },
  { href: '/admin/departments', label: 'Departments', icon: <Buildings {...icon} /> },
  { href: '/admin/clubs', label: 'Clubs', icon: <Users {...icon} /> },
  { href: '/admin/events', label: 'Events', icon: <CalendarDots {...icon} /> },
  { href: '/admin/audit', label: 'Audit', icon: <Shield {...icon} /> },
  { href: '/admin/exports', label: 'Exports', icon: <DownloadSimple {...icon} /> },
] as const;
