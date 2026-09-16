import { ConsoleShell } from '@/components/shell/ConsoleShell';
import { Bar, TableSkeleton } from '@/components/shell/skeleton-parts';

export default function Loading() {
  return (
    <ConsoleShell title="Club">
      <div className="flex flex-col gap-4">
        <Bar className="h-8 w-1/2" />
        <TableSkeleton rows={8} cols={4} />
      </div>
    </ConsoleShell>
  );
}
