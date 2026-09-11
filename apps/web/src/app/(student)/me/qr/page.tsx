import type { Metadata } from 'next';
import { EmptyState } from '@/components/EmptyState';
import { StudentShell } from '@/components/shell/StudentShell';

export const metadata: Metadata = { title: 'My QR' };

export default function MyQrPage() {
  return (
    <StudentShell title="My QR">
      <EmptyState title="Your pass arrives in Stage 6" />
    </StudentShell>
  );
}
