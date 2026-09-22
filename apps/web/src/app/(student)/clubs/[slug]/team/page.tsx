import type { AppointmentPage } from '@majlis/contracts';
import type { Metadata } from 'next';
import { TeamManager } from '@/components/club/TeamManager';
import { StudentShell } from '@/components/shell/StudentShell';
import { requireClubSection } from '@/lib/officer-access';
import { PAGE } from '@/lib/page-size';
import { serverFetch } from '@/lib/server-api';

export const metadata: Metadata = { title: 'Team' };

export default async function ClubTeamPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { user, club } = await requireClubSection(slug, 'team');
  const team = await serverFetch<AppointmentPage>(`/clubs/${club.id}/team?limit=${PAGE}`);

  return (
    <StudentShell title="Team">
      <TeamManager
        clubId={club.id}
        viewerUserId={user.id}
        initialClub={club}
        initialTeam={team}
      />
    </StudentShell>
  );
}
