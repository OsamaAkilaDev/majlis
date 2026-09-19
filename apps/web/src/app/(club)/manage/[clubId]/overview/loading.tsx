import { Bar } from '@/components/shell/skeleton-parts';

export default function Loading() {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Bar key={i} className="h-24 rounded-card" />
        ))}
      </div>
      <Bar className="h-64 w-full rounded-card" />
    </div>
  );
}
