import type { ClubSection } from '@/components/shell/ClubWorkspace';

/**
 * A club's sections are tabs inside the workspace, not a side navigation: the
 * rail belongs to the platform and never changes. No icons, for the same
 * reason a browser's tab strip has none.
 */
export function clubSections(clubId: string): ClubSection[] {
  const base = `/manage/${clubId}`;
  return [
    { href: `${base}/overview`, label: 'Overview' },
    { href: `${base}/members`, label: 'Members' },
    { href: `${base}/team`, label: 'Team' },
    { href: `${base}/events`, label: 'Events' },
    { href: `${base}/scan`, label: 'Scan' },
    { href: `${base}/certificates`, label: 'Certificates' },
    { href: `${base}/reports`, label: 'Reports' },
  ];
}
