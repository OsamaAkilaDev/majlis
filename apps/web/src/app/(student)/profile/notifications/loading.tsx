import { StudentShell } from '@/components/shell/StudentShell';
import { RowsSkeleton } from '@/components/shell/skeleton-parts';

export default function Loading() {
  return (
    <StudentShell title="Inbox">
      <RowsSkeleton count={6} />
    </StudentShell>
  );
}
