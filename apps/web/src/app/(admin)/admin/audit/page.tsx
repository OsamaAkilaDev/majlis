import type { Metadata } from 'next';
import { EmptyState } from '@/components/EmptyState';
import { ConsoleShell } from '@/components/shell/ConsoleShell';
import { ADMIN_NAV } from '../nav';

export const metadata: Metadata = { title: 'Audit' };

export default function AuditPage() {
  return (
    <ConsoleShell items={ADMIN_NAV} title="Audit" context={null}>
      <EmptyState title="Nothing here yet" />
    </ConsoleShell>
  );
}
