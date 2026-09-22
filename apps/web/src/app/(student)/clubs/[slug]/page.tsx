import type { ClubDetail as Club, EventPage } from '@majlis/contracts';
import type { Metadata } from 'next';
import { StudentShell } from '@/components/shell/StudentShell';
import { PAGE } from '@/lib/page-size';
import { serverFetch } from '@/lib/server-api';
import { ClubDetail } from './ClubDetail';

export const metadata: Metadata = { title: 'Club' };

export default async function ClubDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const club = await serverFetch<Club>(`/clubs/by-slug/${encodeURIComponent(slug)}`);

  // Sequential, and it has to be: the events are filtered by club id, which
  // only the call above knows. Two hops on the server's own network still beat
  // one from the browser, which cannot start until the shell's JS has
  // hydrated.
  const events = club
    ? await serverFetch<EventPage>(`/events?clubId=${club.id}&limit=${PAGE}`)
    : null;

  // The club's own name once the server has it: the header is the viewer's
  // sense of place, and "Club" tells them nothing they did not already know.
  return (
    <StudentShell title={club?.name ?? 'Club'}>
      <ClubDetail slug={slug} initialClub={club} initialEvents={events} />
    </StudentShell>
  );
}
