import { ConsoleShell } from '@/components/shell/ConsoleShell';
import { Bar } from '@/components/shell/skeleton-parts';

export default function Loading() {
  return (
    <ConsoleShell title="New club">
      <div className="mx-auto flex w-full max-w-xl flex-col gap-4">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="flex flex-col gap-1.5">
            <Bar className="h-3.5 w-24" />
            <Bar className="h-9 w-full rounded-control" />
          </div>
        ))}
        <Bar className="h-9 w-32 rounded-control" />
      </div>
    </ConsoleShell>
  );
}
