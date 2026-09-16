import { ConsoleShell } from '@/components/shell/ConsoleShell';
import { Bar } from '@/components/shell/skeleton-parts';

export default function Loading() {
  return (
    <ConsoleShell title="Exports">
      <div className="flex flex-col gap-3">
        {Array.from({ length: 4 }, (_, i) => (
          <Bar key={i} className="h-16 w-full rounded-card" />
        ))}
      </div>
    </ConsoleShell>
  );
}
