import { StudentShell } from '@/components/shell/StudentShell';
import { Bar, RowsSkeleton, SectionSkeleton } from '@/components/shell/skeleton-parts';

// The title is the club's name, which is not known until the fetch lands, so
// the header carries an ellipsis rather than a wrong name that then changes.
export default function Loading() {
  return (
    <StudentShell title="Club">
      <div className="flex flex-col gap-6">
        <Bar className="aspect-[8/3] w-full rounded-card" />
        <div className="-mt-15 flex items-end gap-4 px-3">
          <Bar className="size-19 shrink-0 rounded-card" />
          <span className="flex min-w-0 flex-1 flex-col gap-2 pb-1">
            <Bar className="h-6 w-1/2" />
            <Bar className="h-3.5 w-1/3" />
          </span>
        </div>
        <Bar className="h-9 w-full rounded-control sm:w-40" />
        <Bar className="h-16 w-full" />
        <SectionSkeleton width="w-28">
          <RowsSkeleton count={3} action={false} />
        </SectionSkeleton>
      </div>
    </StudentShell>
  );
}
