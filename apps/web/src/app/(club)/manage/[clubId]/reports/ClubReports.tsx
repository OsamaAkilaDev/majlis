'use client';

import type { AuditPage, ClubReport } from '@majlis/contracts';
import { useEffect, useState } from 'react';
import { AuditTable } from '@/components/AuditTable';
import { BarChart, StatTile } from '@/components/BarChart';
import { Skeleton } from '@/components/ui/skeleton';
import { clubReport, listClubAudit } from '@/lib/reporting';
import { useAsyncError } from '@/lib/use-async-error';

export function ClubReports({
  clubId,
  initialReport,
  initialAudit,
  canAudit,
}: {
  clubId: string;
  initialReport: ClubReport | null;
  initialAudit: AuditPage | null;
  canAudit: boolean;
}) {
  const [report, setReport] = useState(initialReport);
  const fail = useAsyncError();

  useEffect(() => {
    if (initialReport) return;
    clubReport(clubId).then(setReport).catch(fail);
  }, [clubId, initialReport, fail]);

  return (
    <div className="flex flex-col gap-6">
      {!report ? (
        <Skeleton className="h-48" />
      ) : (
        <div className="flex flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile label="Events" value={report.events} />
            <StatTile label="Registrations" value={report.registrations} />
            <StatTile label="Attendance" value={`${Math.round(report.attendanceRate * 100)}%`} />
            <StatTile label="Certificates" value={report.certificatesIssued} />
          </div>

          {/* Expected excludes the waitlist: somebody who never held a place
              was never expected in the room. */}
          <BarChart
            title="Attendance"
            bars={[
              { label: 'Expected', value: report.expected },
              { label: 'Attended', value: report.attended },
            ]}
          />
        </div>
      )}

      {canAudit ? (
        <section className="flex flex-col gap-3">
          {/* The scope is in the heading, not in a sentence under it. AuditLog
              has no foreign keys (spec 3), so there is no join to walk past
              the club row and its events. */}
          <h2 className="font-display text-h2 text-ink">Audit: this club and its events</h2>
          <AuditTable
            initial={initialAudit}
            clubId={clubId}
            fetchPage={(query) => listClubAudit(clubId, query)}
          />
        </section>
      ) : null}
    </div>
  );
}
