import type { DepartmentPage } from '@majlis/contracts';
import type { Metadata } from 'next';
import { ClubProfile } from '@/components/ClubProfile';
import { StudentShell } from '@/components/shell/StudentShell';
import { requireClubSection } from '@/lib/officer-access';
import { serverFetch } from '@/lib/server-api';

export const metadata: Metadata = { title: 'Edit club' };

export default async function ClubEditPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { user, club } = await requireClubSection(slug, 'edit');
  const departments = await serverFetch<DepartmentPage>('/departments?limit=100');

  return (
    <StudentShell title="Edit club">
      <ClubProfile
        clubId={club.id}
        platformRole={user.platformRole}
        initialClub={club}
        initialDepartments={departments?.items ?? null}
      />
    </StudentShell>
  );
}
