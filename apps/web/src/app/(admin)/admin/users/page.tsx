import type { UserListPage } from '@majlis/contracts';
import type { Metadata } from 'next';
import { ConsoleShell } from '@/components/shell/ConsoleShell';
import { PAGE } from '@/lib/page-size';
import { serverFetch } from '@/lib/server-api';
import { requireUser } from '@/lib/session';
import { UsersManager } from './UsersManager';

export const metadata: Metadata = { title: 'Users' };

export default async function UsersPage() {
  // requireUser is memoised by getSessionUser, which the shell already
  // called, so the viewer costs no extra round trip here.
  const [user, users] = await Promise.all([
    requireUser(),
    serverFetch<UserListPage>(`/users?limit=${PAGE}`),
  ]);

  return (
    <ConsoleShell title="Users">
      <UsersManager viewerId={user.id} initialUsers={users} />
    </ConsoleShell>
  );
}
