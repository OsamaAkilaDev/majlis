import type { SessionUser } from '@majlis/contracts';
import { STUDENT_TAB_ROUTES } from '@/components/shell/student-tab-routes';
import { ADMIN_NAV_ROUTES } from '@/app/(admin)/admin/nav-routes';
import { activeNavHref, landingFor } from '@/lib/routing';

/**
 * Every primary navigation destination across every shell: the student dock's
 * three tabs and the admin sidebar's five sections. Reads the route lists
 * directly rather than STUDENT_TABS/ADMIN_NAV: those exports carry phosphor
 * icon components, and pulling them in here would drag
 * @phosphor-icons/react/ssr into this test's node environment for no reason.
 */
const ROOT_HREFS: string[] = [...STUDENT_TAB_ROUTES, ...ADMIN_NAV_ROUTES].map((r) => r.href);

/**
 * The dock's own destinations and the admin sidebar's own sections, the only
 * screens with no back. `/admin/users`, the admin landing reached by `/admin`
 * redirecting to it, is one of these: without it, a cold deep link there has
 * `backFallback` resolve to `/admin`, which redirects straight back, so a
 * visible back control presses to nowhere.
 */
export function isTabRoot(pathname: string): boolean {
  const path = pathname.length > 1 ? pathname.replace(/\/$/, '') : pathname;
  return ROOT_HREFS.includes(path);
}

/**
 * Where the back button sends a viewer who has no history in this app to go
 * back to, such as one who arrived on a notification's deep link with the
 * screen it opened as their only entry. Prefers the section the current
 * screen is under, so an event, club or admin deep link returns to the
 * section it lives on rather than jumping to a different one.
 */
export function backFallback(pathname: string, user: SessionUser): string {
  const tabHref = activeNavHref(pathname, ROOT_HREFS);
  return tabHref ?? landingFor(user);
}
