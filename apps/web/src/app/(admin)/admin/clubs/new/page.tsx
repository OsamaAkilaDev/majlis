import type { DepartmentPage } from '@majlis/contracts';
import type { Metadata } from 'next';
import { ConsoleShell } from '@/components/shell/ConsoleShell';
import { serverFetch } from '@/lib/server-api';
import { ADMIN_NAV } from '../../nav';
import { ClubCreateForm } from './ClubCreateForm';

export const metadata: Metadata = { title: 'New club' };

export default async function NewClubPage() {
  const departments = await serverFetch<DepartmentPage>('/departments?limit=100');

  return (
    <ConsoleShell items={ADMIN_NAV} title="New club" context={null}>
      <ClubCreateForm initialDepartments={departments?.items ?? null} />
    </ConsoleShell>
  );
}
