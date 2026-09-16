import { ConsoleShell } from '@/components/shell/ConsoleShell';
import { Bar, TableSkeleton } from '@/components/shell/skeleton-parts';

export default function Loading() {
  return (
    <ConsoleShell title="Members">
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <Bar className="h-9 w-full rounded-control sm:w-64" />
          <Bar className="h-9 w-36 rounded-control" />
        </div>
        <TableSkeleton rows={10} cols={4} />
      </div>
    </ConsoleShell>
  );
}
