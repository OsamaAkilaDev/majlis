import type { ReactNode } from 'react';
import { PageError } from '@/components/PageError';
import { ConsoleFrame } from '@/components/shell/ConsoleFrame';
import { requireUser } from '@/lib/session';
import { clubNav } from './nav';

export default async function ManageLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ clubId: string }>;
}) {
  const { clubId } = await params;
  const user = await requireUser();

  // Re-derived from the database on every request. A club ID in the URL is a
  // claim, never a permission (spec 11).
  const holdsRole = user.clubRoles.some((r) => r.clubId === clubId);
  if (!holdsRole && user.platformRole !== 'ADMIN') {
    return <PageError title="You do not have access to this club" />;
  }

  return (
    <ConsoleFrame items={clubNav(clubId)} session={{ user }}>
      {children}
    </ConsoleFrame>
  );
}
