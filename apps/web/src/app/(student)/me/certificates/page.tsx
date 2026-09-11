import type { Metadata } from 'next';
import { EmptyState } from '@/components/EmptyState';
import { StudentShell } from '@/components/shell/StudentShell';

export const metadata: Metadata = { title: 'My certificates' };

export default function MyCertificatesPage() {
  return (
    <StudentShell title="My certificates">
      <EmptyState title="No certificates yet" />
    </StudentShell>
  );
}
