import type { Metadata } from 'next';
import { StudentShell } from '@/components/shell/StudentShell';
import { EventDetail } from './EventDetail';

export const metadata: Metadata = { title: 'Event' };

export default async function EventDetailPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;

  return (
    <StudentShell title="Event">
      <EventDetail eventId={eventId} />
    </StudentShell>
  );
}
