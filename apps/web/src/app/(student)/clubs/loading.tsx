import { StudentShell } from '@/components/shell/StudentShell';
import { ClubGridSkeleton, FiltersSkeleton } from '@/components/shell/skeleton-parts';

export default function Loading() {
  return (
    <StudentShell title="Clubs">
      <div className="flex flex-col gap-4">
        <FiltersSkeleton selects={2} />
        <ClubGridSkeleton count={6} />
      </div>
    </StudentShell>
  );
}
