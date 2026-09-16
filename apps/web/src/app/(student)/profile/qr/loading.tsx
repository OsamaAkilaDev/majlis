import { StudentShell } from '@/components/shell/StudentShell';
import { Bar } from '@/components/shell/skeleton-parts';

export default function Loading() {
  return (
    <StudentShell title="My QR">
      <div className="mx-auto flex h-full w-full max-w-sm flex-col items-center justify-center gap-4">
        <Bar className="h-[22rem] w-full rounded-sheet" />
        <Bar className="h-11 w-36 rounded-control" />
      </div>
    </StudentShell>
  );
}
