import type { MyRegistrationPage } from '@majlis/contracts';
import type { Metadata } from 'next';
import { StudentShell } from '@/components/shell/StudentShell';
import { PAGE } from '@/lib/page-size';
import { serverFetch } from '@/lib/server-api';
import { RegistrationsManager } from './RegistrationsManager';

export const metadata: Metadata = { title: 'My registrations' };

export default async function MyRegistrationsPage() {
  const initial = await serverFetch<MyRegistrationPage>(`/me/registrations?limit=${PAGE}`);

  return (
    <StudentShell title="My registrations">
      <RegistrationsManager initial={initial} />
    </StudentShell>
  );
}
