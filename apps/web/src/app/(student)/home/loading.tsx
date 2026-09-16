import { StudentShell } from '@/components/shell/StudentShell';
import { Bar } from '@/components/shell/skeleton-parts';

export default function Loading() {
  return (
    <StudentShell title="Home">
      <Bar className="h-44 w-full rounded-card" />
    </StudentShell>
  );
}
