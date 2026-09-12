import type { Metadata } from 'next';
import { ConsoleShell } from '@/components/shell/ConsoleShell';
import { ADMIN_NAV } from '../nav';
import { EventsOverview } from './EventsOverview';

export const metadata: Metadata = { title: 'Events' };

export default function EventsPage() {
  return (
    <ConsoleShell items={ADMIN_NAV} title="Events" context={null}>
      <EventsOverview />
    </ConsoleShell>
  );
}
