import type { Metadata } from 'next';
import { EmptyState } from '@/components/EmptyState';
import { ConsoleShell } from '@/components/shell/ConsoleShell';
import { ADMIN_NAV } from '../nav';

export const metadata: Metadata = { title: 'Exports' };

export default function ExportsPage() {
  return (
    <ConsoleShell items={ADMIN_NAV} title="Exports" context={null}>
      <EmptyState title="Nothing here yet" />
    </ConsoleShell>
  );
}
