import type { Metadata } from 'next';
import { EmptyState } from '@/components/EmptyState';
import { ConsoleShell } from '@/components/shell/ConsoleShell';
import { ADMIN_NAV } from '../nav';

export const metadata: Metadata = { title: 'Metrics' };

export default function MetricsPage() {
  return (
    <ConsoleShell items={ADMIN_NAV} title="Metrics" context={null}>
      <EmptyState title="Nothing here yet" />
    </ConsoleShell>
  );
}
