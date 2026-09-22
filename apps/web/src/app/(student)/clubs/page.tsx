import type { MyClubPage } from '@majlis/contracts';
import type { Metadata } from 'next';
import { SearchLink } from '@/components/shell/SearchLink';
import { StudentShell } from '@/components/shell/StudentShell';
import { PAGE } from '@/lib/page-size';
import { serverFetch } from '@/lib/server-api';
import { ClubGroups } from './ClubGroups';

export const metadata: Metadata = { title: 'Clubs' };

export default async function ClubsPage() {
  const clubs = await serverFetch<MyClubPage>(`/me/clubs?limit=${PAGE}`);

  return (
    <StudentShell title="Clubs" action={<SearchLink href="/clubs/discover" label="Find a club" />}>
      <ClubGroups initial={clubs} />
    </StudentShell>
  );
}
