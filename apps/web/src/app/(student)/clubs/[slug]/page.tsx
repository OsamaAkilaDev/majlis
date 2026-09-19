import type { ClubDetail as Club } from '@majlis/contracts';
import type { Metadata } from 'next';
import { StudentShell } from '@/components/shell/StudentShell';
import { serverFetch } from '@/lib/server-api';
import { ClubDetail } from './ClubDetail';

export const metadata: Metadata = { title: 'Club' };

export default async function ClubDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const club = await serverFetch<Club>(`/clubs/by-slug/${encodeURIComponent(slug)}`);

  // The club's own name once the server has it: the header is the viewer's
  // sense of place, and "Club" tells them nothing they did not already know.
  return (
    <StudentShell title={club?.name ?? 'Club'}>
      <ClubDetail slug={slug} initialClub={club} />
    </StudentShell>
  );
}
