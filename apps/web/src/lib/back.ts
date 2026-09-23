import type { SessionUser } from '@majlis/contracts';
import { STUDENT_TAB_ROUTES } from '@/components/shell/student-tab-routes';
import { activeNavHref, landingFor } from '@/lib/routing';

/**
 * The dock's own destinations, and the only screens with no back. Derived from
 * STUDENT_TAB_ROUTES rather than restated, so adding a tab cannot leave a back
 * button on it that walks the viewer out of the app. Reads the route list
 * directly rather than STUDENT_TABS: that export carries phosphor icon
 * components, and pulling it in here would drag @phosphor-icons/react/ssr into
 * this test's node environment for no reason.
 */
export function isTabRoot(pathname: string): boolean {
  const path = pathname.length > 1 ? pathname.replace(/\/$/, '') : pathname;
  return STUDENT_TAB_ROUTES.some((tab) => tab.href === path);
}

/**
 * Where the back button sends a viewer who has no history in this app to go
 * back to, such as one who arrived on a notification's deep link with the
 * screen it opened as their only entry. Prefers the tab whose section the
 * current screen is under, so an event or club deep link returns to the tab
 * it lives on rather than jumping to a different one.
 */
export function backFallback(pathname: string, user: SessionUser): string {
  const tabHref = activeNavHref(
    pathname,
    STUDENT_TAB_ROUTES.map((tab) => tab.href),
  );
  return tabHref ?? landingFor(user);
}
