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

  return (
    <ConsoleFrame items={ADMIN_NAV} session={{ user }}>
      {children}
    </ConsoleFrame>
  );
}
