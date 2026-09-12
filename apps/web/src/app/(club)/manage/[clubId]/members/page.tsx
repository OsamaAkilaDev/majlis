import type { ClubDetail, MemberPage } from '@majlis/contracts';
import type { Metadata } from 'next';
import { ConsoleShell } from '@/components/shell/ConsoleShell';
import { serverFetch } from '@/lib/server-api';
import { clubNav } from '../nav';
import { MembersManager } from './MembersManager';

export const metadata: Metadata = { title: 'Members' };

export default async function MembersPage({ params }: { params: Promise<{ clubId: string }> }) {
  const { clubId } = await params;
  const [club, pending, active] = await Promise.all([
    serverFetch<ClubDetail>(`/clubs/${clubId}`),
    serverFetch<MemberPage>(`/clubs/${clubId}/members?status=PENDING&limit=100`),
    serverFetch<MemberPage>(`/clubs/${clubId}/members?status=ACTIVE&limit=100`),
  ]);

  return (
    <ConsoleShell items={clubNav(clubId)} title="Members" context={null}>
      <MembersManager
        clubId={clubId}
        initialClub={club}
        initialPending={pending?.items ?? null}
        initialActive={active?.items ?? null}
      />
    </ConsoleShell>
  );
}
