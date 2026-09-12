import type { EventDetail as Event } from '@majlis/contracts';
import type { Metadata } from 'next';
import { StudentShell } from '@/components/shell/StudentShell';
import { serverFetch } from '@/lib/server-api';
import { EventDetail } from './EventDetail';

export const metadata: Metadata = { title: 'Event' };

export default async function EventDetailPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  const event = await serverFetch<Event>(`/events/${eventId}`);

  return (
    <StudentShell title="Event">
      <EventDetail eventId={eventId} initialEvent={event} />
    </StudentShell>
  );
}
