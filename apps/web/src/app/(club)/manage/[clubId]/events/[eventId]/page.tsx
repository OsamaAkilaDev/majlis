import type { Metadata } from 'next';
import { ConsoleShell } from '@/components/shell/ConsoleShell';
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
  const user = await requireUser();

  return (
    <ConsoleShell items={clubNav(clubId)} title="Event" context={null}>
      <EventEditor eventId={eventId} platformRole={user.platformRole} />
    </ConsoleShell>
  );
}
