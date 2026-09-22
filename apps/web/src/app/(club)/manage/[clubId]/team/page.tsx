import type { AppointmentPage, ClubDetail } from '@majlis/contracts';
import type { Metadata } from 'next';
import { CONSOLE_PAGE } from '@/lib/page-size';
import { serverFetch } from '@/lib/server-api';
import { requireUser } from '@/lib/session';
import { TeamManager } from '@/components/club/TeamManager';

export const metadata: Metadata = { title: 'Team' };

export default async function TeamPage({ params }: { params: Promise<{ clubId: string }> }) {
  const { clubId } = await params;
  const [user, club, team] = await Promise.all([
    requireUser(),
    serverFetch<ClubDetail>(`/clubs/${clubId}`),
    serverFetch<AppointmentPage>(`/clubs/${clubId}/team?limit=${CONSOLE_PAGE}`),
  ]);

  return (
    <TeamManager
      clubId={clubId}
      viewerUserId={user.id}
      initialClub={club}
      initialTeam={team}
    />
  );
}
