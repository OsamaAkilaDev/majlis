import type { Metadata } from 'next';
import { ConsoleShell } from '@/components/shell/ConsoleShell';
import { ADMIN_NAV } from '../../nav';
import { ClubDetailManager } from './ClubDetailManager';

export const metadata: Metadata = { title: 'Club' };

export default async function AdminClubDetailPage({ params }: { params: Promise<{ clubId: string }> }) {
  const { clubId } = await params;

  return (
    <ConsoleShell items={ADMIN_NAV} title="Club" context={null}>
      <ClubDetailManager clubId={clubId} />
    </ConsoleShell>
  );
}
