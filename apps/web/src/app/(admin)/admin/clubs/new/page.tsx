import type { Metadata } from 'next';
import { ConsoleShell } from '@/components/shell/ConsoleShell';
import { ADMIN_NAV } from '../../nav';
import { ClubCreateForm } from './ClubCreateForm';

export const metadata: Metadata = { title: 'New club' };

export default function NewClubPage() {
  return (
    <ConsoleShell items={ADMIN_NAV} title="New club" context={null}>
      <ClubCreateForm />
    </ConsoleShell>
  );
}
