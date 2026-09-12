import type { EventPage } from '@majlis/contracts';
import type { Metadata } from 'next';
import { ConsoleShell } from '@/components/shell/ConsoleShell';
import { CONSOLE_PAGE } from '@/lib/page-size';
import { serverFetch } from '@/lib/server-api';
import { requireUser } from '@/lib/session';
import { clubNav } from '../nav';
import { CertificatesManager } from './CertificatesManager';

export const metadata: Metadata = { title: 'Certificates' };

export default async function CertificatesPage({
  params,
}: {
  params: Promise<{ clubId: string }>;
}) {
  const { clubId } = await params;
  const [user, events] = await Promise.all([
    requireUser(),
    serverFetch<EventPage>(`/events?clubId=${clubId}&limit=${CONSOLE_PAGE}`),
  ]);

  return (
    <ConsoleShell items={clubNav(clubId)} title="Certificates" context={null}>
      <CertificatesManager
        clubId={clubId}
        platformRole={user.platformRole}
        initialEvents={events?.items ?? null}
      />
    </ConsoleShell>
  );
}
