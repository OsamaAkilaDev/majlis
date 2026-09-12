import type { Metadata } from 'next';
import { ConsoleShell } from '@/components/shell/ConsoleShell';
import { clubNav } from '../nav';
import { MembersManager } from './MembersManager';

export const metadata: Metadata = { title: 'Members' };

export default async function MembersPage({ params }: { params: Promise<{ clubId: string }> }) {
  const { clubId } = await params;

  return (
    <ConsoleShell items={clubNav(clubId)} title="Members" context={null}>
      <MembersManager clubId={clubId} />
    </ConsoleShell>
  );
}
