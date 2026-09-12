import type { ReactNode } from 'react';
import { PageError } from '@/components/PageError';
import { requireUser } from '@/lib/session';

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();
  if (user.platformRole !== 'ADMIN') {
    return <PageError title="You do not have access to the admin console" />;
  }
  return children;
}
