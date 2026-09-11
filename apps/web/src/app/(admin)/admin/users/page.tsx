import type { Metadata } from 'next';
import { EmptyState } from '@/components/EmptyState';
import { ConsoleShell } from '@/components/shell/ConsoleShell';
import { ADMIN_NAV } from '../nav';

export const metadata: Metadata = { title: 'Users' };

export default function UsersPage() {
  return (
    <ConsoleShell items={ADMIN_NAV} title="Users" context={null}>
      <EmptyState title="Nothing here yet" />
    </ConsoleShell>
  );
}
