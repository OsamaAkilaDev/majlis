import type { ClubDetail, EventDetail, SessionUser } from '@majlis/contracts';
import { notFound, redirect } from 'next/navigation';
import { canCreateEvent, clubSectionsFor, type ClubSectionKey } from '@/lib/club-sections';
import { eventActionsFor, type EventActionKey } from '@/lib/event-actions';
import { serverFetch } from '@/lib/server-api';
import { requireUser } from '@/lib/session';

/**
 * The gate every officer route inside the student shell opens with.
 *
 * A slug or an id in a URL is a claim, so the club is read back from the API
 * and the viewer's roles come from that read, not from anything the browser
 * sent. The API refuses the underlying calls regardless; this is what keeps a
 * viewer off a screen that would answer them 403, and it redirects rather than
 * rendering a page with a refusal panel in it.
 *
 * `serverFetch` is memoised per request, so the caller asking for the same
 * club or event again is one call, not two.
 */
async function club(slug: string): Promise<{ user: SessionUser; club: ClubDetail }> {
  const [user, found] = await Promise.all([
    requireUser(),
    serverFetch<ClubDetail>(`/clubs/by-slug/${encodeURIComponent(slug)}`),
  ]);
  if (!found) notFound();
  return { user, club: found };
}

export async function requireClubSection(
  slug: string,
  key: ClubSectionKey,
): Promise<{ user: SessionUser; club: ClubDetail }> {
  const found = await club(slug);
  const allowed = clubSectionsFor(found.club.viewerClubRoles, found.user.platformRole);
  if (!allowed.some((s) => s.key === key)) redirect(`/clubs/${slug}`);
  return found;
}

export async function requireEventCreate(
  slug: string,
): Promise<{ user: SessionUser; club: ClubDetail }> {
  const found = await club(slug);
  if (!canCreateEvent(found.club.viewerClubRoles, found.user.platformRole)) {
    redirect(`/clubs/${slug}`);
  }
  return found;
}

export async function requireEventAction(
  eventId: string,
  key: EventActionKey,
): Promise<{ user: SessionUser; event: EventDetail }> {
  const [user, event] = await Promise.all([
    requireUser(),
    serverFetch<EventDetail>(`/events/${eventId}`),
  ]);
  if (!event) notFound();
  if (!eventActionsFor(event, new Date(), user.platformRole).some((a) => a.key === key)) {
    redirect(`/events/${eventId}`);
  }
  return { user, event };
}
