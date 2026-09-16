import type { NotificationPage } from '@majlis/contracts';
import type { Metadata } from 'next';
import { StudentShell } from '@/components/shell/StudentShell';
import { PAGE } from '@/lib/page-size';
import { serverFetch } from '@/lib/server-api';
import { Inbox } from './Inbox';

export const metadata: Metadata = { title: 'Inbox' };

export default async function NotificationsPage() {
  const initial = await serverFetch<NotificationPage>(`/me/notifications?limit=${PAGE}`);

  return (
    <StudentShell title="Inbox">
      <Inbox initial={initial} />
    </StudentShell>
  );
}
