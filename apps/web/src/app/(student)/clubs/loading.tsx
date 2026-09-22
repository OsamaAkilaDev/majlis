import { StudentShell } from '@/components/shell/StudentShell';
import { RowsSkeleton, SectionSkeleton } from '@/components/shell/skeleton-parts';

export default function Loading() {
  return (
    <StudentShell title="Clubs">
      <div className="flex flex-col gap-6">
        <SectionSkeleton width="w-32">
          <RowsSkeleton count={4} />
        </SectionSkeleton>
      </div>
    </StudentShell>
  );
}
