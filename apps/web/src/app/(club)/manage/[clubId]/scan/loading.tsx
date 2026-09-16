import { ConsoleShell } from '@/components/shell/ConsoleShell';
import { Bar } from '@/components/shell/skeleton-parts';

export default function Loading() {
  return (
    <ConsoleShell title="Scan">
      <div className="mx-auto flex w-full max-w-md flex-col gap-4">
        <Bar className="aspect-square w-full rounded-card" />
        <Bar className="h-11 w-full rounded-control" />
      </div>
    </ConsoleShell>
  );
}
