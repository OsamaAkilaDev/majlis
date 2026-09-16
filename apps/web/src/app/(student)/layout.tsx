import type { NotificationPage } from '@majlis/contracts';
import type { ReactNode } from 'react';
import { StudentFrame } from '@/components/shell/StudentFrame';
import { UNREAD_CAP } from '@/lib/page-size';
import { serverFetch } from '@/lib/server-api';
import { requireUser } from '@/lib/session';

/**
 * The one place on the student shell that awaits anything.
 *
 * A layout is not re-rendered when the viewer moves between its children, so
 * both of these are paid once per shell mount rather than once per navigation.
 * The unread count used to be fetched by every page's header; it no longer is.
 */
export default async function StudentLayout({ children }: { children: ReactNode }) {
  const [user, unread] = await Promise.all([
    requireUser(),
    serverFetch<NotificationPage>(`/me/notifications?unread=true&limit=${UNREAD_CAP}`),
  ]);

  return (
    <StudentFrame session={{ user, unread: unread?.items.length ?? 0 }}>{children}</StudentFrame>
  );
}
