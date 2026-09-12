import { Building2, CalendarDays, Download, LayoutGrid, Shield, User, Users } from 'lucide-react';

const iconClass = 'size-4 shrink-0';

export const ADMIN_NAV = [
  { href: '/admin/metrics', label: 'Metrics', icon: <LayoutGrid className={iconClass} aria-hidden /> },
  { href: '/admin/users', label: 'Users', icon: <User className={iconClass} aria-hidden /> },
  { href: '/admin/departments', label: 'Departments', icon: <Building2 className={iconClass} aria-hidden /> },
  { href: '/admin/clubs', label: 'Clubs', icon: <Users className={iconClass} aria-hidden /> },
  { href: '/admin/events', label: 'Events', icon: <CalendarDays className={iconClass} aria-hidden /> },
  { href: '/admin/audit', label: 'Audit', icon: <Shield className={iconClass} aria-hidden /> },
  { href: '/admin/exports', label: 'Exports', icon: <Download className={iconClass} aria-hidden /> },
] as const;
