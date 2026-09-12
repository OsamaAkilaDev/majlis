import type { DepartmentPage } from '@majlis/contracts';
import type { Metadata } from 'next';
import { ConsoleShell } from '@/components/shell/ConsoleShell';
import { PAGE } from '@/lib/page-size';
import { serverFetch } from '@/lib/server-api';
import { ADMIN_NAV } from '../nav';
import { DepartmentsManager } from './DepartmentsManager';

export const metadata: Metadata = { title: 'Departments' };

export default async function DepartmentsPage() {
  const initial = await serverFetch<DepartmentPage>(`/departments?limit=${PAGE}`);

  return (
    <ConsoleShell items={ADMIN_NAV} title="Departments" context={null}>
      <DepartmentsManager initial={initial} />
    </ConsoleShell>
  );
}
