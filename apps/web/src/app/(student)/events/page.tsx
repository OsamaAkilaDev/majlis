import type { CertificatePage, EventPage, MyRegistrationPage } from '@majlis/contracts';
import type { Metadata } from 'next';
import { SearchLink } from '@/components/shell/SearchLink';
import { StudentShell } from '@/components/shell/StudentShell';
import { PAGE } from '@/lib/page-size';
import { serverFetch } from '@/lib/server-api';
import { EventGroups } from './EventGroups';

export const metadata: Metadata = { title: 'Events' };

export default async function EventsPage() {
  // Parallel, and on the server: the browser would otherwise wait for the
  // shell's JS to hydrate before any of them left the machine.
  const [registered, fromClubs, past, certificates] = await Promise.all([
    serverFetch<MyRegistrationPage>(`/me/registrations?past=false&limit=${PAGE}`),
    // `fromMyClubs` does not imply `upcoming`, so both are sent.
    serverFetch<EventPage>(`/events?upcoming=true&fromMyClubs=true&limit=${PAGE}`),
    serverFetch<MyRegistrationPage>(`/me/registrations?past=true&limit=${PAGE}`),
    serverFetch<CertificatePage>(`/me/certificates?limit=${PAGE}`),
  ]);

  return (
    <StudentShell
      title="Events"
      action={<SearchLink href="/events/discover" label="Discover events" />}
    >
      <EventGroups
        registered={registered}
        fromClubs={fromClubs}
        past={past}
        certifiedEventIds={(certificates?.items ?? []).map((c) => c.eventId)}
      />
    </StudentShell>
  );
}
