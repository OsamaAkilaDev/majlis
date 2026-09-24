import type { EventPage } from '@majlis/contracts';
import type { Metadata } from 'next';
import { CONSOLE_PAGE } from '@/lib/page-size';
import { serverFetch } from '@/lib/server-api';
import { CertificatesManager } from './CertificatesManager';

export const metadata: Metadata = { title: 'Certificates' };

export default async function CertificatesPage({
  params,
}: {
  params: Promise<{ clubId: string }>;
}) {
  const { clubId } = await params;
  const events = await serverFetch<EventPage>(`/events?clubId=${clubId}&limit=${CONSOLE_PAGE}`);

  return <CertificatesManager clubId={clubId} initialEvents={events?.items ?? null} />;
}
