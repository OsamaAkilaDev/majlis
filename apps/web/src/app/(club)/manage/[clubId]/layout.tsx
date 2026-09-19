import type { ClubDetail } from '@majlis/contracts';
import type { ReactNode } from 'react';
import { PageError } from '@/components/PageError';
import { ClubWorkspace } from '@/components/shell/ClubWorkspace';
import { ConsoleFrame } from '@/components/shell/ConsoleFrame';
import { STUDENT_NAV } from '@/components/shell/student-nav';
import { serverFetch } from '@/lib/server-api';
import { requireUser } from '@/lib/session';
import { ADMIN_NAV } from '../../../(admin)/admin/nav';
import { clubSections } from './nav';

export default async function ManageLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ clubId: string }>;
}) {
  const { clubId } = await params;
  const user = await requireUser();

  // Re-derived from the database on every request. A club ID in the URL is a
  // claim, never a permission (spec 11).
  const holdsRole = user.clubRoles.some((r) => r.clubId === clubId);
  const isAdmin = user.platformRole === 'ADMIN';
  if (!holdsRole && !isAdmin) {
    return <PageError title="You do not have access to this club" />;
  }

  // Paid once per shell mount, not once per section: a layout is not
  // re-rendered when the viewer moves between its children.
  const club = await serverFetch<ClubDetail>(`/clubs/${clubId}`);

  // The rail is the platform's, whoever the viewer is. Entering a club used to
  // replace all five platform entries with seven club ones, with no breadcrumb
  // and no route back.
  return (
    <ConsoleFrame items={isAdmin ? ADMIN_NAV : STUDENT_NAV} session={{ user }}>
      <ClubWorkspace
        clubId={clubId}
        club={club}
        sections={clubSections(clubId)}
        backHref={isAdmin ? '/admin/clubs' : '/clubs'}
      >
        {children}
      </ClubWorkspace>
    </ConsoleFrame>
  );
}
