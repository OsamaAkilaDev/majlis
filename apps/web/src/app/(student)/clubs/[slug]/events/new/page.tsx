import type { Metadata } from 'next';
import { EventCreateForm } from '@/components/event/EventCreateForm';
import { StudentShell } from '@/components/shell/StudentShell';
import { requireEventCreate } from '@/lib/officer-access';
import { needsOverrideReason } from '@/lib/override';

export const metadata: Metadata = { title: 'New event' };

export default async function NewEventPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { user, club } = await requireEventCreate(slug);

  return (
    <StudentShell title="New event">
      <EventCreateForm
        clubId={club.id}
        override={needsOverrideReason(user.platformRole, club.viewerClubRoles)}
      />
    </StudentShell>
  );
}
