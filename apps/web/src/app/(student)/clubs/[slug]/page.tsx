import type { Metadata } from 'next';
import { StudentShell } from '@/components/shell/StudentShell';
import { ClubDetail } from './ClubDetail';

export const metadata: Metadata = { title: 'Club' };

export default async function ClubDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  return (
    <StudentShell title="Club">
      <ClubDetail slug={slug} />
    </StudentShell>
  );
}
