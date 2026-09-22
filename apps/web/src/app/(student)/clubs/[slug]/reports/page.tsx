import type { AuditPage, ClubReport } from '@majlis/contracts';
import type { Metadata } from 'next';
import { ClubReports } from '@/components/club/ClubReports';
import { StudentShell } from '@/components/shell/StudentShell';
import { requireClubSection } from '@/lib/officer-access';
import { PAGE } from '@/lib/page-size';
import { serverFetch } from '@/lib/server-api';

export const metadata: Metadata = { title: 'Reports' };

export default async function ClubReportsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { user, club } = await requireClubSection(slug, 'reports');

  const [report, audit] = await Promise.all([
    serverFetch<ClubReport>(`/clubs/${club.id}/reports`),
    serverFetch<AuditPage>(`/clubs/${club.id}/audit?limit=${PAGE}`),
  ]);

  // `report:read` is held by Lead and Vice Lead, `audit:read` by Lead alone
  // (spec 6.1), so the section that reaches this screen is not the section
  // that reaches the log inside it. Re-derived from the club the server just
  // read, not from the URL.
  const canAudit =
    user.platformRole === 'ADMIN' || club.viewerClubRoles.includes('LEAD');

  return (
    <StudentShell title="Reports">
      <ClubReports
        clubId={club.id}
        initialReport={report}
        initialAudit={audit}
        canAudit={canAudit}
      />
    </StudentShell>
  );
}
