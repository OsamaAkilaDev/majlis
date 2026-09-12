import type { Metadata } from 'next';
import { ConsoleShell } from '@/components/shell/ConsoleShell';
import { requireUser } from '@/lib/session';
import { clubNav } from '../nav';
import { OverviewManager } from './OverviewManager';

export const metadata: Metadata = { title: 'Overview' };

export default async function OverviewPage({ params }: { params: Promise<{ clubId: string }> }) {
  const { clubId } = await params;
  const user = await requireUser();

  return (
    <ConsoleShell items={clubNav(clubId)} title="Overview" context={null}>
      <OverviewManager clubId={clubId} platformRole={user.platformRole} />
    </ConsoleShell>
  );
}
