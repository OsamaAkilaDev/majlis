import type { AuditPage } from '@majlis/contracts';
import type { Metadata } from 'next';
import { ConsoleShell } from '@/components/shell/ConsoleShell';
import { CONSOLE_PAGE } from '@/lib/page-size';
import { serverFetch } from '@/lib/server-api';
import { AdminAudit } from './AdminAudit';

export const metadata: Metadata = { title: 'Audit' };

export default async function AuditPage() {
  const initial = await serverFetch<AuditPage>(`/audit?limit=${CONSOLE_PAGE}`);

  return (
    <ConsoleShell title="Audit">
      <AdminAudit initial={initial} />
    </ConsoleShell>
  );
}
