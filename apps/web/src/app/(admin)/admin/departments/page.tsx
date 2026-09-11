import type { Metadata } from 'next';
import { EmptyState } from '@/components/EmptyState';
import { ConsoleShell } from '@/components/shell/ConsoleShell';
import { ADMIN_NAV } from '../nav';

export const metadata: Metadata = { title: 'Departments' };

export default function DepartmentsPage() {
  return (
    <ConsoleShell items={ADMIN_NAV} title="Departments" context={null}>
      <EmptyState title="Nothing here yet" />
    </ConsoleShell>
  );
}
