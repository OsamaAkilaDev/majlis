import type { CertificatePage } from '@majlis/contracts';
import type { Metadata } from 'next';
import { StudentShell } from '@/components/shell/StudentShell';
import { PAGE } from '@/lib/page-size';
import { serverFetch } from '@/lib/server-api';
import { MyCertificates } from './MyCertificates';

export const metadata: Metadata = { title: 'My certificates' };

export default async function MyCertificatesPage() {
  const initial = await serverFetch<CertificatePage>(`/me/certificates?limit=${PAGE}`);

  return (
    <StudentShell title="My certificates">
      <MyCertificates initial={initial} />
    </StudentShell>
  );
}
