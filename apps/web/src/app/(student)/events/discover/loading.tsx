import { StudentShell } from '@/components/shell/StudentShell';
import { EventGridSkeleton, FiltersSkeleton } from '@/components/shell/skeleton-parts';

export default function Loading() {
  return (
    <StudentShell title="Discover">
      <div className="flex flex-col gap-4">
        <FiltersSkeleton selects={2} />
        <EventGridSkeleton count={6} />
      </div>
    </StudentShell>
  );
}
