import type { Metadata } from 'next';
import { EmptyState } from '@/components/EmptyState';
import { ConsoleShell } from '@/components/shell/ConsoleShell';
import { ADMIN_NAV } from '../nav';

export const metadata: Metadata = { title: 'Clubs' };

export default function ClubsPage() {
  return (
    <ConsoleShell items={ADMIN_NAV} title="Clubs" context={null}>
      <EmptyState title="Nothing here yet" />
    </ConsoleShell>
  );
}
