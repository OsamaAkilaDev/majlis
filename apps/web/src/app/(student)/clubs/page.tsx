import type { Metadata } from 'next';
import { EmptyState } from '@/components/EmptyState';
import { StudentShell } from '@/components/shell/StudentShell';

export const metadata: Metadata = { title: 'Clubs' };

export default function ClubsPage() {
  return (
    <StudentShell title="Clubs">
      <EmptyState title="No clubs yet" />
    </StudentShell>
  );
}
