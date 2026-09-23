/**
 * The sidebar's own destinations, href and label only, no icon. Split out of
 * nav.tsx so a module that only needs the routes, such as `back.ts` and its
 * test, does not pull `@phosphor-icons/react/ssr` along with it.
 */
export const ADMIN_NAV_ROUTES = [
  { href: '/admin/users', label: 'Users' },
  { href: '/admin/departments', label: 'Departments' },
  { href: '/admin/clubs', label: 'Clubs' },
  { href: '/admin/events', label: 'Events' },
  { href: '/admin/audit', label: 'Audit' },
] as const;
