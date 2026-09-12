import type { AppointmentPage, ClubDetail } from '@majlis/contracts';
import type { Metadata } from 'next';
import { ConsoleShell } from '@/components/shell/ConsoleShell';
import { serverFetch } from '@/lib/server-api';
import { ADMIN_NAV } from '../../nav';
import { ClubDetailManager } from './ClubDetailManager';

export const metadata: Metadata = { title: 'Club' };

export default async function AdminClubDetailPage({ params }: { params: Promise<{ clubId: string }> }) {
  const { clubId } = await params;
  const [club, team] = await Promise.all([
    serverFetch<ClubDetail>(`/clubs/${clubId}`),
    serverFetch<AppointmentPage>(`/clubs/${clubId}/team?limit=100`),
  ]);

  return (
    <ConsoleShell items={ADMIN_NAV} title="Club" context={null}>
      <ClubDetailManager clubId={clubId} initialClub={club} initialTeam={team?.items ?? null} />
    </ConsoleShell>
  );
}
