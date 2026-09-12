import type { Metadata } from 'next';
import { EmptyState } from '@/components/EmptyState';
import { ConsoleShell } from '@/components/shell/ConsoleShell';
import { clubNav } from '../nav';

export const metadata: Metadata = { title: 'Events' };

export default async function EventsPage({ params }: { params: Promise<{ clubId: string }> }) {
  const { clubId } = await params;

  return (
    <ConsoleShell items={clubNav(clubId)} title="Events" context={null}>
      <EmptyState title="Nothing here yet" />
    </ConsoleShell>
  );
}
