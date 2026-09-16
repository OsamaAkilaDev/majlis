import { StudentShell } from '@/components/shell/StudentShell';
import { RowsSkeleton } from '@/components/shell/skeleton-parts';

export default function Loading() {
  return (
    <StudentShell title="My registrations">
      <RowsSkeleton count={5} />
    </StudentShell>
  );
}
