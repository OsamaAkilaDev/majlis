import type { Metadata } from 'next';
import { StudentShell } from '@/components/shell/StudentShell';
import { ClubBrowser } from './ClubBrowser';

export const metadata: Metadata = { title: 'Clubs' };

export default function ClubsPage() {
  return (
    <StudentShell title="Clubs">
      <ClubBrowser />
    </StudentShell>
  );
}
