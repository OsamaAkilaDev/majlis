'use client';

import type { OverviewReport } from '@majlis/contracts';
import { useEffect, useState } from 'react';
import { BarChart, StatTile } from '@/components/BarChart';
import { Skeleton } from '@/components/ui/skeleton';
import { statusBars } from '@/lib/chart';
import { enumLabel } from '@/lib/enum-label';
import { overviewReport } from '@/lib/reporting';
import { useAsyncError } from '@/lib/use-async-error';

const CLUB_STATUSES = ['ACTIVE', 'PENDING', 'SUSPENDED', 'ARCHIVED'] as const;

const EVENT_STATUSES = [
  'DRAFT',
  'PUBLISHED',
  'REGISTRATION_CLOSED',
  'ONGOING',
  'COMPLETED',
  'CERTIFIED',
  'CANCELLED',
] as const;

export function MetricsBoard({ initial }: { initial: OverviewReport | null }) {
  const [report, setReport] = useState(initial);
  const fail = useAsyncError();

  useEffect(() => {
    if (initial) return;
    overviewReport().then(setReport).catch(fail);
  }, [initial, fail]);

  if (!report) {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-24" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <StatTile label="Users" value={report.users} />
        <StatTile label="Active memberships" value={report.activeMemberships} />
        <StatTile label="Certificates issued" value={report.certificatesIssued} />
      </div>

      {/* Two charts, never one with two axes: clubs and events are separate
          populations and a shared scale would invent a comparison. */}
      <div className="grid gap-3 lg:grid-cols-2 lg:items-start">
        <BarChart
          title="Clubs by status"
          bars={statusBars(report.clubsByStatus, CLUB_STATUSES, enumLabel)}
        />
        <BarChart
          title="Events by status"
          bars={statusBars(report.eventsByStatus, EVENT_STATUSES, enumLabel)}
        />
      </div>
    </div>
  );
}
