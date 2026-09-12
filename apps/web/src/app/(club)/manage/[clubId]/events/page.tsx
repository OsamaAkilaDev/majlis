import type { Metadata } from 'next';
import { ConsoleShell } from '@/components/shell/ConsoleShell';
import { requireUser } from '@/lib/session';
import { clubNav } from '../nav';
import { EventsManager } from './EventsManager';

export const metadata: Metadata = { title: 'Events' };

export default async function EventsPage({ params }: { params: Promise<{ clubId: string }> }) {
  const { clubId } = await params;
  const user = await requireUser();

  return (
    <ConsoleShell items={clubNav(clubId)} title="Events" context={null}>
      <EventsManager clubId={clubId} platformRole={user.platformRole} />
    </ConsoleShell>
  );
}
