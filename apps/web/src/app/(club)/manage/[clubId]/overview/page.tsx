import type { ClubDetail, DepartmentPage } from '@majlis/contracts';
import type { Metadata } from 'next';
import { ConsoleShell } from '@/components/shell/ConsoleShell';
import { serverFetch } from '@/lib/server-api';
import { requireUser } from '@/lib/session';
import { OverviewManager } from './OverviewManager';

export const metadata: Metadata = { title: 'Overview' };

export default async function OverviewPage({ params }: { params: Promise<{ clubId: string }> }) {
  const { clubId } = await params;
  const [user, club, departments] = await Promise.all([
    requireUser(),
    serverFetch<ClubDetail>(`/clubs/${clubId}`),
    serverFetch<DepartmentPage>('/departments?limit=100'),
  ]);

  return (
    <ConsoleShell title="Overview">
      <OverviewManager
        clubId={clubId}
        platformRole={user.platformRole}
        initialClub={club}
        initialDepartments={departments?.items ?? null}
      />
    </ConsoleShell>
  );
}
