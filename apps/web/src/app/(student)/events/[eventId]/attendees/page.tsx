import type { AttendancePage, RegistrationPage } from '@majlis/contracts';
import type { Metadata } from 'next';
import { EventAttendees } from '@/components/event/EventAttendees';
import { StudentShell } from '@/components/shell/StudentShell';
import { requireEventAction } from '@/lib/officer-access';
import { PAGE } from '@/lib/page-size';
import { serverFetch } from '@/lib/server-api';

export const metadata: Metadata = { title: 'Attendees' };

export default async function EventAttendeesPage({
  params,
}: {
  params: Promise<{ eventId: string }>;
}) {
  const { eventId } = await params;
  const { user, event } = await requireEventAction(eventId, 'attendees');

  const [roster, attendance] = await Promise.all([
    serverFetch<RegistrationPage>(`/events/${eventId}/registrations?limit=${PAGE}`),
    serverFetch<AttendancePage>(`/events/${eventId}/attendance?limit=${PAGE}`),
  ]);

  return (
    <StudentShell title="Attendees">
      <EventAttendees
        eventId={eventId}
        platformRole={user.platformRole}
        initialEvent={event}
        initialRoster={roster}
        initialAttendance={attendance}
      />
    </StudentShell>
  );
}
