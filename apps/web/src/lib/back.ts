import { STUDENT_TAB_ROUTES } from '@/components/shell/student-tab-routes';

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
