import { Buildings, CalendarDots, Shield, User, Users } from '@phosphor-icons/react/ssr';
import type { Icon } from '@phosphor-icons/react';
import { ICON_WEIGHT } from '@/lib/icons';
import { ADMIN_NAV_ROUTES } from './nav-routes';

const ICONS: Record<(typeof ADMIN_NAV_ROUTES)[number]['href'], Icon> = {
  '/admin/users': User,
  '/admin/departments': Buildings,
  '/admin/clubs': Users,
  '/admin/events': CalendarDots,
  '/admin/audit': Shield,
};

export const ADMIN_NAV = ADMIN_NAV_ROUTES.map(({ href, label }) => {
  const IconComponent = ICONS[href];
  return { href, label, icon: <IconComponent size={16} weight={ICON_WEIGHT} className="shrink-0" aria-hidden /> };
});
