import type { ClubPage, EventPage } from '@majlis/contracts';
import type { Metadata } from 'next';
import { StudentShell } from '@/components/shell/StudentShell';
import { PAGE } from '@/lib/page-size';
import { serverFetch } from '@/lib/server-api';
import { EventBrowser } from './EventBrowser';

export const metadata: Metadata = { title: 'Events' };

export default async function EventsPage({
  searchParams,
}: {
  searchParams: Promise<{ club?: string }>;
}) {
  // A club page's "see all" lands here already filtered to that club.
  const { club } = await searchParams;
  const filter = club ? `&clubId=${encodeURIComponent(club)}` : '';

  // Parallel, and on the server: the browser would otherwise wait for the
  // shell's JS to hydrate before either request left the machine.
  const [events, clubs] = await Promise.all([
    serverFetch<EventPage>(`/events?upcoming=true&limit=${PAGE}${filter}`),
    serverFetch<ClubPage>('/clubs?status=ACTIVE&limit=100'),
  ]);

  return (
    <StudentShell title="Events">
      <EventBrowser
        initialEvents={events}
        initialClubs={clubs?.items ?? null}
        initialClubId={club}
      />
    </StudentShell>
  );
}
