import type { ClubPage, EventPage } from '@majlis/contracts';
import type { Metadata } from 'next';
import { ConsoleShell } from '@/components/shell/ConsoleShell';
import { PAGE } from '@/lib/page-size';
import { serverFetch } from '@/lib/server-api';
import { ADMIN_NAV } from '../nav';
import { EventsOverview } from './EventsOverview';

export const metadata: Metadata = { title: 'Events' };

export default async function EventsPage() {
  const [events, clubs] = await Promise.all([
    serverFetch<EventPage>(`/events?limit=${PAGE}`),
    serverFetch<ClubPage>('/clubs?limit=100'),
  ]);

  return (
    <ConsoleShell items={ADMIN_NAV} title="Events" context={null}>
      <EventsOverview initialEvents={events} initialClubs={clubs?.items ?? null} />
    </ConsoleShell>
  );
}
