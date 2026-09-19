import type { EventPage } from '@majlis/contracts';
import type { Metadata } from 'next';
import { CONSOLE_PAGE } from '@/lib/page-size';
import { serverFetch } from '@/lib/server-api';
import { requireUser } from '@/lib/session';
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
    <CertificatesManager
      clubId={clubId}
      platformRole={user.platformRole}
      initialEvents={events?.items ?? null}
    />
  );
}
