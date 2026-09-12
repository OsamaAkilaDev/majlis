import type { Metadata } from 'next';
import { EmptyState } from '@/components/EmptyState';
import { StudentShell } from '@/components/shell/StudentShell';

export const metadata: Metadata = { title: 'Me' };

export default function MePage() {
  return (
    <StudentShell title="Me">
      <EmptyState title="Nothing here yet" />
    </StudentShell>
  );
}
