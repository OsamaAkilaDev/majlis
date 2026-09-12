import type { Metadata } from 'next';
import { StudentShell } from '@/components/shell/StudentShell';
import { RegistrationsManager } from './RegistrationsManager';

export const metadata: Metadata = { title: 'My registrations' };

export default function MyRegistrationsPage() {
  return (
    <StudentShell title="My registrations">
      <RegistrationsManager />
    </StudentShell>
  );
}
