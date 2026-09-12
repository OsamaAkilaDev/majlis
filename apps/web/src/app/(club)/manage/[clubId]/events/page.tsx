import type { ClubDetail, EventPage } from '@majlis/contracts';
import type { Metadata } from 'next';
import { ConsoleShell } from '@/components/shell/ConsoleShell';
import { CONSOLE_PAGE } from '@/lib/page-size';
import { serverFetch } from '@/lib/server-api';
import { requireUser } from '@/lib/session';
import { clubNav } from '../nav';
import { EventsManager } from './EventsManager';

export const metadata: Metadata = { title: 'Events' };

export default async function EventsPage({ params }: { params: Promise<{ clubId: string }> }) {
  const { clubId } = await params;
  const [user, club, events] = await Promise.all([
    requireUser(),
    serverFetch<ClubDetail>(`/clubs/${clubId}`),
    serverFetch<EventPage>(`/events?clubId=${clubId}&limit=${CONSOLE_PAGE}`),
  ]);

  return (
    <ConsoleShell items={clubNav(clubId)} title="Events" context={null}>
      <EventsManager
        clubId={clubId}
        platformRole={user.platformRole}
        initialRoles={club?.viewerClubRoles ?? null}
        initialEvents={events}
      />
    </ConsoleShell>
  );
}
