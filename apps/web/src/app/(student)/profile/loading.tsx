import { StudentShell } from '@/components/shell/StudentShell';
import { Bar, RowsSkeleton, SectionSkeleton } from '@/components/shell/skeleton-parts';

export default function Loading() {
  return (
    <StudentShell title="Profile">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        {/* The identity banner, which is a fixed height whatever it holds. */}
        <Bar className="h-[6.5rem] w-full rounded-sheet sm:h-28" />

        <div className="grid grid-cols-2 gap-2.5">
          <Bar className="h-[6.75rem] rounded-card" />
          <Bar className="h-[6.75rem] rounded-card" />
        </div>

        <SectionSkeleton width="w-28">
          <RowsSkeleton count={2} />
        </SectionSkeleton>

        <SectionSkeleton width="w-32">
          <Bar className="h-[3.25rem] w-full rounded-card" />
        </SectionSkeleton>

        <Bar className="h-10 w-full rounded-control" />
      </div>
    </StudentShell>
  );
}
