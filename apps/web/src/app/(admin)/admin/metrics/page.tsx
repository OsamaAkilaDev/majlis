import type { OverviewReport } from '@majlis/contracts';
import type { Metadata } from 'next';
import { ConsoleShell } from '@/components/shell/ConsoleShell';
import { serverFetch } from '@/lib/server-api';
import { ADMIN_NAV } from '../nav';
import { MetricsBoard } from './MetricsBoard';

export const metadata: Metadata = { title: 'Metrics' };

export default async function MetricsPage() {
  const initial = await serverFetch<OverviewReport>('/reports/overview');

  return (
    <ConsoleShell items={ADMIN_NAV} title="Metrics" context={null}>
      <MetricsBoard initial={initial} />
    </ConsoleShell>
  );
}
