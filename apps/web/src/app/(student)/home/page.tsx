import type { Metadata } from 'next';
import { EmptyState } from '@/components/EmptyState';
import { StudentShell } from '@/components/shell/StudentShell';

export const metadata: Metadata = { title: 'Home' };

export default function HomePage() {
  return (
    <StudentShell title="Home">
      <EmptyState title="Nothing here yet" />
    </StudentShell>
  );
}
