import type { Metadata } from 'next';
import { StudentShell } from '@/components/shell/StudentShell';
import { EventBrowser } from './EventBrowser';

export const metadata: Metadata = { title: 'Events' };

export default function EventsPage() {
  return (
    <StudentShell title="Events">
      <EventBrowser />
    </StudentShell>
  );
}
