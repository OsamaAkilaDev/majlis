import { Bar, TableSkeleton } from '@/components/shell/skeleton-parts';

export default function Loading() {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <Bar className="h-64 rounded-card" />
        <Bar className="h-64 rounded-card" />
      </div>
      <TableSkeleton rows={6} cols={4} />
    </div>
  );
}
