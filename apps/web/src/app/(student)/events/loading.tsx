import { StudentShell } from '@/components/shell/StudentShell';
import { RowsSkeleton, SectionSkeleton } from '@/components/shell/skeleton-parts';

export default function Loading() {
  return (
    <StudentShell title="Events">
      <div className="flex flex-col gap-6">
        <SectionSkeleton width="w-28">
          <RowsSkeleton count={3} />
        </SectionSkeleton>
        <SectionSkeleton width="w-40">
          <RowsSkeleton count={3} />
        </SectionSkeleton>
      </div>
    </StudentShell>
  );
}
