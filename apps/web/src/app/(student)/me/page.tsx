import type { InvitationPage, MyClubPage } from '@majlis/contracts';
import type { Metadata } from 'next';
import { StudentShell } from '@/components/shell/StudentShell';
import { PAGE } from '@/lib/page-size';
import { serverFetch } from '@/lib/server-api';
import { MeManager } from './MeManager';

export const metadata: Metadata = { title: 'Me' };

export default async function MePage() {
  const [clubs, invitations] = await Promise.all([
    serverFetch<MyClubPage>(`/me/clubs?limit=${PAGE}`),
    serverFetch<InvitationPage>(`/me/invitations?limit=${PAGE}`),
  ]);

  return (
    <StudentShell title="Me">
      <MeManager
        initialClubs={clubs?.items ?? null}
        initialInvitations={invitations?.items ?? null}
      />
    </StudentShell>
  );
}
