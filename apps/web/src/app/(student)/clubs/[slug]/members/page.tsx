import type { MemberPage } from '@majlis/contracts';
import type { Metadata } from 'next';
import { MembersManager } from '@/components/club/MembersManager';
import { StudentShell } from '@/components/shell/StudentShell';
import { requireClubSection } from '@/lib/officer-access';
import { PAGE } from '@/lib/page-size';
import { serverFetch } from '@/lib/server-api';

export const metadata: Metadata = { title: 'Members' };

export default async function ClubMembersPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { club } = await requireClubSection(slug, 'members');

  // One round trip more than the console paid, because the slug had to resolve
  // before the club's id was known.
  const [pending, active] = await Promise.all([
    serverFetch<MemberPage>(`/clubs/${club.id}/members?status=PENDING&limit=${PAGE}`),
    serverFetch<MemberPage>(`/clubs/${club.id}/members?status=ACTIVE&limit=${PAGE}`),
  ]);

  return (
    <StudentShell title="Members">
      <MembersManager
        clubId={club.id}
        initialClub={club}
        initialPending={pending}
        initialActive={active}
        limit={PAGE}
      />
    </StudentShell>
  );
}
