import type { Metadata } from 'next';
import { EmptyState } from '@/components/EmptyState';
import { ConsoleShell } from '@/components/shell/ConsoleShell';

export const metadata: Metadata = { title: 'Users' };

export default function UsersPage() {
  return (
    <ConsoleShell title="Users">
      <EmptyState title="Nothing here yet" />
    </ConsoleShell>
  );
}
