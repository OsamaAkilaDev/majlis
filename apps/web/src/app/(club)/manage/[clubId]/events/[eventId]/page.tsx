import type { AssignmentList, EventDetail, RegistrationPage } from '@majlis/contracts';
import type { Metadata } from 'next';
import { ConsoleShell } from '@/components/shell/ConsoleShell';
import { serverFetch } from '@/lib/server-api';
import { requireUser } from '@/lib/session';
import { clubNav } from '../../nav';
import { EventEditor } from './EventEditor';

export const metadata: Metadata = { title: 'Event' };

export default async function EventEditorPage({
  params,
}: {
  params: Promise<{ clubId: string; eventId: string }>;
}) {
  const { clubId, eventId } = await params;
  // The two sections read behind their own permission come back null on a 403,
  // which is the section not existing rather than an error.
  const [user, event, assignments, roster] = await Promise.all([
    requireUser(),
    serverFetch<EventDetail>(`/events/${eventId}`),
    serverFetch<AssignmentList>(`/events/${eventId}/assignments`),
    serverFetch<RegistrationPage>(`/events/${eventId}/registrations?limit=100`),
  ]);

  return (
    <ConsoleShell items={clubNav(clubId)} title="Event" context={null}>
      <EventEditor
        eventId={eventId}
        platformRole={user.platformRole}
        initialEvent={event}
        initialAssignments={assignments?.items ?? null}
        initialRoster={roster?.items ?? null}
      />
    </ConsoleShell>
  );
}
