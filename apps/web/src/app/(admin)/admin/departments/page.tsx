import type { Metadata } from 'next';
import { ConsoleShell } from '@/components/shell/ConsoleShell';
import { ADMIN_NAV } from '../nav';
import { DepartmentsManager } from './DepartmentsManager';

export const metadata: Metadata = { title: 'Departments' };

export default function DepartmentsPage() {
  return (
    <ConsoleShell items={ADMIN_NAV} title="Departments" context={null}>
      <DepartmentsManager />
    </ConsoleShell>
  );
}
