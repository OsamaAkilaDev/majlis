import type { ReactNode } from 'react';
import { PageError } from '@/components/PageError';
import { ConsoleFrame } from '@/components/shell/ConsoleFrame';
import { requireUser } from '@/lib/session';
import { ADMIN_NAV } from './nav';

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();
  if (user.platformRole !== 'ADMIN') {
    return <PageError title="You do not have access to the admin console" />;
  }

  // No unread count: a console header carries the theme toggle and the avatar,
  // and no bell. Fetching one here bought nothing and cost a round trip on
  // every console mount, which was enough to delay /admin's redirect past the
  // point where the accessibility scan caught the empty intermediate document.
  return (
    <ConsoleFrame items={ADMIN_NAV} session={{ user, unread: 0 }}>
      {children}
    </ConsoleFrame>
  );
}
