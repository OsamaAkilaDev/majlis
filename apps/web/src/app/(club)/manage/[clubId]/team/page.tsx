import type { AppointmentPage, ClubDetail } from '@majlis/contracts';
import type { Metadata } from 'next';
import { ConsoleShell } from '@/components/shell/ConsoleShell';
import { serverFetch } from '@/lib/server-api';
import { requireUser } from '@/lib/session';
import { clubNav } from '../nav';
import { TeamManager } from './TeamManager';

export const metadata: Metadata = { title: 'Team' };

export default async function TeamPage({ params }: { params: Promise<{ clubId: string }> }) {
  const { clubId } = await params;
  const [user, club, team] = await Promise.all([
    requireUser(),
    serverFetch<ClubDetail>(`/clubs/${clubId}`),
    serverFetch<AppointmentPage>(`/clubs/${clubId}/team?limit=100`),
  ]);

  return (
    <ConsoleShell items={clubNav(clubId)} title="Team" context={null}>
      <TeamManager
        clubId={clubId}
        viewerUserId={user.id}
        initialClub={club}
        initialTeam={team?.items ?? null}
      />
    </ConsoleShell>
  );
}
