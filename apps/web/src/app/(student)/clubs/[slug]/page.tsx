import type { ClubDetail as Club } from '@majlis/contracts';
import type { Metadata } from 'next';
import { StudentShell } from '@/components/shell/StudentShell';
import { serverFetch } from '@/lib/server-api';
import { ClubDetail } from './ClubDetail';

export const metadata: Metadata = { title: 'Club' };

export default async function ClubDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const club = await serverFetch<Club>(`/clubs/by-slug/${encodeURIComponent(slug)}`);

  return (
    <StudentShell title="Club">
      <ClubDetail slug={slug} initialClub={club} />
    </StudentShell>
  );
}
