import { ConsoleShell } from '@/components/shell/ConsoleShell';
import { Bar } from '@/components/shell/skeleton-parts';

export default function Loading() {
  return (
    <ConsoleShell title="Metrics">
      <div className="flex flex-col gap-4">
        <div className="grid gap-4 lg:grid-cols-2">
          <Bar className="h-64 rounded-card" />
          <Bar className="h-64 rounded-card" />
        </div>
        <Bar className="h-24 w-full rounded-card" />
      </div>
    </ConsoleShell>
  );
}
