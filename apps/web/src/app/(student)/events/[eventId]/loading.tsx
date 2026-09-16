import { StudentShell } from '@/components/shell/StudentShell';
import { Bar } from '@/components/shell/skeleton-parts';

export default function Loading() {
  return (
    <StudentShell title="Event">
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-3">
          <span className="flex items-center gap-2">
            <Bar className="size-5 shrink-0 rounded-control" />
            <Bar className="h-3.5 w-32" />
          </span>
          <Bar className="h-8 w-3/4" />
          <Bar className="h-4 w-1/2" />
        </div>
        <Bar className="h-11 w-40 rounded-control" />
        <Bar className="h-28 w-full rounded-card" />
      </div>
    </StudentShell>
  );
}
