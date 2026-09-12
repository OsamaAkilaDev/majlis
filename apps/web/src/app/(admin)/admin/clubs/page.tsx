import type { ClubPage, DepartmentPage } from '@majlis/contracts';
import type { Metadata } from 'next';
import { ConsoleShell } from '@/components/shell/ConsoleShell';
import { PAGE } from '@/lib/page-size';
import { serverFetch } from '@/lib/server-api';
import { ADMIN_NAV } from '../nav';
import { ClubsManager } from './ClubsManager';

export const metadata: Metadata = { title: 'Clubs' };

export default async function ClubsPage() {
  const [clubs, departments] = await Promise.all([
    serverFetch<ClubPage>(`/clubs?limit=${PAGE}`),
    serverFetch<DepartmentPage>('/departments?limit=100'),
  ]);

  return (
    <ConsoleShell items={ADMIN_NAV} title="Clubs" context={null}>
      <ClubsManager initialClubs={clubs} initialDepartments={departments?.items ?? null} />
    </ConsoleShell>
  );
}
