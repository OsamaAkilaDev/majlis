import { ConsoleShell } from '@/components/shell/ConsoleShell';
import { Bar } from '@/components/shell/skeleton-parts';

export default function Loading() {
  return (
    <ConsoleShell title="Event">
      <div className="flex flex-col gap-4">
        <Bar className="h-8 w-1/2" />
        <div className="grid gap-4 lg:grid-cols-2">
          <Bar className="h-80 rounded-card" />
          <Bar className="h-80 rounded-card" />
        </div>
      </div>
    </ConsoleShell>
  );
}
