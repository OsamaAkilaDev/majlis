import type { Metadata } from 'next';
import { ConsoleShell } from '@/components/shell/ConsoleShell';
import { requireUser } from '@/lib/session';
import { clubNav } from '../nav';
import { TeamManager } from './TeamManager';

export const metadata: Metadata = { title: 'Team' };

export default async function TeamPage({ params }: { params: Promise<{ clubId: string }> }) {
  const { clubId } = await params;
  const user = await requireUser();

  return (
    <ConsoleShell items={clubNav(clubId)} title="Team" context={null}>
      <TeamManager clubId={clubId} viewerUserId={user.id} />
    </ConsoleShell>
  );
}
