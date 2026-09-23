/**
 * The dock's three destinations, href and label only, no icon. Split out of
 * student-nav.tsx so a module that only needs the routes, such as `back.ts` and
 * its test, does not pull in `@phosphor-icons/react/ssr` along with it.
 */
export const STUDENT_TAB_ROUTES = [
  { href: '/events', label: 'Events' },
  { href: '/clubs', label: 'Clubs' },
  { href: '/profile/qr', label: 'QR' },
] as const;
