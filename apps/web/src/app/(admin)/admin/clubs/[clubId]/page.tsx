import type { AppointmentPage, ClubDetail } from '@majlis/contracts';
import type { Metadata } from 'next';
import { ConsoleShell } from '@/components/shell/ConsoleShell';
import { serverFetch } from '@/lib/server-api';
import { ClubDetailManager } from './ClubDetailManager';

export const metadata: Metadata = { title: 'Club' };

export default async function AdminClubDetailPage({ params }: { params: Promise<{ clubId: string }> }) {
  const { clubId } = await params;
  const [club, team] = await Promise.all([
    serverFetch<ClubDetail>(`/clubs/${clubId}`),
    serverFetch<AppointmentPage>(`/clubs/${clubId}/team?limit=100`),
  ]);

  return (
    <ConsoleShell title="Club">
      <ClubDetailManager clubId={clubId} initialClub={club} initialTeam={team?.items ?? null} />
    </ConsoleShell>
  );
}
