import type { AssignmentList, AttendancePage, EventDetail, RegistrationPage } from '@majlis/contracts';
import { PAGE } from '@/lib/page-size';
import type { Metadata } from 'next';
import { serverFetch } from '@/lib/server-api';
import { requireUser } from '@/lib/session';
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
  const [user, event, assignments, roster, attendance] = await Promise.all([
    requireUser(),
    serverFetch<EventDetail>(`/events/${eventId}`),
    serverFetch<AssignmentList>(`/events/${eventId}/assignments?limit=${PAGE}`),
    serverFetch<RegistrationPage>(`/events/${eventId}/registrations?limit=${PAGE}`),
    serverFetch<AttendancePage>(`/events/${eventId}/attendance?limit=${PAGE}`),
  ]);

  return (
    <EventEditor
      clubId={clubId}
      eventId={eventId}
      platformRole={user.platformRole}
      initialEvent={event}
      initialAssignments={assignments}
      initialRoster={roster}
      initialAttendance={attendance}
    />
  );
}
