import type { EventPage } from '@majlis/contracts';
import type { Metadata } from 'next';
import { ConsoleShell } from '@/components/shell/ConsoleShell';
import { serverFetch } from '@/lib/server-api';
import { ADMIN_NAV } from '../nav';
import { ExportsBoard } from './ExportsBoard';

export const metadata: Metadata = { title: 'Exports' };

export default async function ExportsPage() {
  const events = await serverFetch<EventPage>('/events?limit=100');

  return (
    <ConsoleShell items={ADMIN_NAV} title="Exports" context={null}>
      <ExportsBoard initialEvents={events?.items ?? null} />
    </ConsoleShell>
  );
}
