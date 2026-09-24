import type { Metadata } from 'next';
import { EventCertificates } from '@/components/event/EventCertificates';
import { StudentShell } from '@/components/shell/StudentShell';
import { requireEventAction } from '@/lib/officer-access';

export const metadata: Metadata = { title: 'Certificates' };

export default async function EventCertificatesPage({
  params,
}: {
  params: Promise<{ eventId: string }>;
}) {
  const { eventId } = await params;
  await requireEventAction(eventId, 'certificates');

  return (
    <StudentShell title="Certificates">
      <EventCertificates eventId={eventId} />
    </StudentShell>
  );
}
