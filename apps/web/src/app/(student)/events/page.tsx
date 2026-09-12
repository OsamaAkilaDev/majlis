import type { Metadata } from 'next';
import { EmptyState } from '@/components/EmptyState';
import { StudentShell } from '@/components/shell/StudentShell';

export const metadata: Metadata = { title: 'Events' };

export default function EventsPage() {
  return (
    <StudentShell title="Events">
      <EmptyState title="No events yet" />
    </StudentShell>
  );
}
