import type {
  AssignmentList,
  AttendancePage,
  EventDetail,
  RegistrationPage,
} from '@majlis/contracts';
import type { Metadata } from 'next';
import { EventAttendees } from '@/components/event/EventAttendees';
import { EventForm } from '@/components/event/EventForm';
import { PAGE } from '@/lib/page-size';
import { serverFetch } from '@/lib/server-api';
import { requireUser } from '@/lib/session';

export const metadata: Metadata = { title: 'Event' };

export default async function EventEditorPage({
  params,
}: {
  params: Promise<{ eventId: string }>;
}) {
  const { eventId } = await params;
  // The sections read behind their own permission come back null on a 403,
  // which is the section not existing rather than an error.
  const [user, event, assignments, roster, attendance] = await Promise.all([
    requireUser(),
    serverFetch<EventDetail>(`/events/${eventId}`),
    serverFetch<AssignmentList>(`/events/${eventId}/assignments?limit=${PAGE}`),
    serverFetch<RegistrationPage>(`/events/${eventId}/registrations?limit=${PAGE}`),
    serverFetch<AttendancePage>(`/events/${eventId}/attendance?limit=${PAGE}`),
  ]);

  // PAGE, not CONSOLE_PAGE: both halves load their own next page at PAGE, and
  // a seed of a different size makes the first "load more" reorder itself.
  //
  // Stacked, because the console is one screen per event. The student shell
  // splits them across two routes along the permission seam instead: an
  // assignee reaching the roster must not reach the control that assigns.
  return (
    <div className="flex flex-col gap-10">
      <EventForm
        eventId={eventId}
        platformRole={user.platformRole}
        initialEvent={event}
        initialAssignments={assignments}
      />
      <EventAttendees
        eventId={eventId}
        platformRole={user.platformRole}
        initialEvent={event}
        initialRoster={roster}
        initialAttendance={attendance}
      />
    </div>
  );
}
