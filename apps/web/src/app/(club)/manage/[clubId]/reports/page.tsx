import type { AuditPage, ClubReport } from '@majlis/contracts';
import type { Metadata } from 'next';
import { CONSOLE_PAGE } from '@/lib/page-size';
import { serverFetch } from '@/lib/server-api';
import { requireUser } from '@/lib/session';
import { ClubReports } from './ClubReports';

export const metadata: Metadata = { title: 'Reports' };

export default async function ReportsPage({ params }: { params: Promise<{ clubId: string }> }) {
  const { clubId } = await params;
  const [user, report, audit] = await Promise.all([
    requireUser(),
    serverFetch<ClubReport>(`/clubs/${clubId}/reports`),
    serverFetch<AuditPage>(`/clubs/${clubId}/audit?limit=${CONSOLE_PAGE}`),
  ]);

  // `report:read` is held by Lead and Vice Lead, `audit:read` by Lead alone
  // (spec 6.1). Rendering the audit table to a Vice Lead would leave them
  // looking at a 403 they can do nothing about. The API refuses it either
  // way; this only keeps the screen honest about what they can read.
  const canAudit =
    user.platformRole === 'ADMIN' ||
    user.clubRoles.some((role) => role.clubId === clubId && role.role === 'LEAD');

  return (
    <ClubReports
      clubId={clubId}
      initialReport={report}
      initialAudit={audit}
      canAudit={canAudit}
    />
  );
}
