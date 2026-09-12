import type { Metadata } from 'next';
import { ConsoleShell } from '@/components/shell/ConsoleShell';
import { ADMIN_NAV } from '../nav';
import { ClubsManager } from './ClubsManager';

export const metadata: Metadata = { title: 'Clubs' };

export default function ClubsPage() {
  return (
    <ConsoleShell items={ADMIN_NAV} title="Clubs" context={null}>
      <ClubsManager />
    </ConsoleShell>
  );
}
