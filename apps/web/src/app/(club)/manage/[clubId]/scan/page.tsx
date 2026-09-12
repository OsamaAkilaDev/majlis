import type { EventPage } from '@majlis/contracts';
import type { Metadata } from 'next';
import { ConsoleShell } from '@/components/shell/ConsoleShell';
import { ScanSession } from '@/components/scanner/ScanSession';
import { CONSOLE_PAGE } from '@/lib/page-size';
import { serverFetch } from '@/lib/server-api';
import { clubNav } from '../nav';

export const metadata: Metadata = { title: 'Scan' };

export default async function ScanPage({ params }: { params: Promise<{ clubId: string }> }) {
  const { clubId } = await params;
  const events = await serverFetch<EventPage>(`/events?clubId=${clubId}&limit=${CONSOLE_PAGE}`);

  return (
    <ConsoleShell items={clubNav(clubId)} title="Scan" context={null} dark>
      <ScanSession clubId={clubId} initialEvents={events?.items ?? null} />
    </ConsoleShell>
  );
}
