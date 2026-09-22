import type { Metadata } from 'next';
import { ScanSession } from '@/components/scanner/ScanSession';
import { StudentShell } from '@/components/shell/StudentShell';
import { requireEventAction } from '@/lib/officer-access';

export const metadata: Metadata = { title: 'Check in' };

export default async function CheckInPage({
  params,
}: {
  params: Promise<{ eventId: string }>;
}) {
  const { eventId } = await params;
  const { event } = await requireEventAction(eventId, 'checkIn');

  return (
    <StudentShell title="Check in">
      {/* The route carries the dark palette itself. `ConsoleFrame` derives it
          from a path ending `/scan`, which this one does not, and the student
          frame has no such rule to hang it on. */}
      <div className="dark">
        <ScanSession event={event} />
      </div>
    </StudentShell>
  );
}
