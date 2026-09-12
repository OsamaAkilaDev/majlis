import type { Metadata } from 'next';
import { EmptyState } from '@/components/EmptyState';
import { StudentShell } from '@/components/shell/StudentShell';

export const metadata: Metadata = { title: 'My registrations' };

export default function MyRegistrationsPage() {
  return (
    <StudentShell title="My registrations">
      <EmptyState title="Nothing booked yet" />
    </StudentShell>
  );
}
