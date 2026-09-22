import type { ClubDetail } from '@majlis/contracts';
import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { ClubWorkspace } from '@/components/shell/ClubWorkspace';
import { ConsoleFrame } from '@/components/shell/ConsoleFrame';
import { consoleRedirect } from '@/lib/routing';
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

  // Re-derived from the database on every request: a club ID in the URL is a
  // claim, never a permission.
  const club = await serverFetch<ClubDetail>(`/clubs/${clubId}`);

  const away = consoleRedirect(user, club?.slug ?? null);
  if (away) redirect(away);

  return (
    <ConsoleFrame items={ADMIN_NAV} session={{ user }}>
      <ClubWorkspace
        clubId={clubId}
        club={club}
        sections={clubSections(clubId)}
        backHref="/admin/clubs"
      >
        {children}
      </ClubWorkspace>
    </ConsoleFrame>
  );
}
