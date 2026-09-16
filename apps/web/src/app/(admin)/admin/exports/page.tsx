import type { EventPage } from '@majlis/contracts';
import type { Metadata } from 'next';
import { ConsoleShell } from '@/components/shell/ConsoleShell';
import { serverFetch } from '@/lib/server-api';
import { ExportsBoard } from './ExportsBoard';

export const metadata: Metadata = { title: 'Exports' };

export default async function ExportsPage() {
  const events = await serverFetch<EventPage>('/events?limit=100&direction=desc');

  return (
    <ConsoleShell title="Exports">
      <ExportsBoard initialEvents={events?.items ?? null} />
    </ConsoleShell>
  );
}
