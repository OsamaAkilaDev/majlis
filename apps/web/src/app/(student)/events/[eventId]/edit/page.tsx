import type { AssignmentList } from '@majlis/contracts';
import type { Metadata } from 'next';
import { EventForm } from '@/components/event/EventForm';
import { StudentShell } from '@/components/shell/StudentShell';
import { requireEventAction } from '@/lib/officer-access';
import { PAGE } from '@/lib/page-size';
import { serverFetch } from '@/lib/server-api';

export const metadata: Metadata = { title: 'Edit event' };

export default async function EditEventPage({
  params,
}: {
  params: Promise<{ eventId: string }>;
}) {
  const { eventId } = await params;
  const { user, event } = await requireEventAction(eventId, 'edit');
  // Null on a 403, which is the assignment roster not existing for this
  // viewer: `event:assign` is Lead and Vice Lead, a narrower audience than the
  // one that reaches this screen.
  const assignments = await serverFetch<AssignmentList>(
    `/events/${eventId}/assignments?limit=${PAGE}`,
  );

  return (
    <StudentShell title="Edit event">
      <EventForm
        eventId={eventId}
        platformRole={user.platformRole}
        initialEvent={event}
        initialAssignments={assignments}
      />
    </StudentShell>
  );
}
