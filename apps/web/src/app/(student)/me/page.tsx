import type { Metadata } from 'next';
import { StudentShell } from '@/components/shell/StudentShell';
import { MeManager } from './MeManager';

export const metadata: Metadata = { title: 'Me' };

export default function MePage() {
  return (
    <StudentShell title="Me">
      <MeManager />
    </StudentShell>
  );
}
