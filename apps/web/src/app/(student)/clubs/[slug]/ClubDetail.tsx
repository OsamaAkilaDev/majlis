'use client';

import { CLUB_EVENT_PREVIEW, type ClubDetail as Club, type ClubEvent } from '@majlis/contracts';
import { CaretRight } from '@phosphor-icons/react/ssr';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { ClubBanner } from '@/components/ClubBanner';
import { EmptyState } from '@/components/EmptyState';
import { StatusBadge } from '@/components/StatusBadge';
import { Skeleton } from '@/components/ui/skeleton';
import { ProblemError } from '@/lib/api';
import { getClubBySlug } from '@/lib/clubs';
import { ICON_WEIGHT } from '@/lib/icons';
import { useAsyncError } from '@/lib/use-async-error';
import { AboutBlock, CommitteeBlock, DepartmentBlock } from './ClubAbout';
import { JoinControl } from './JoinControl';

/** Month and day in the venue's zone, which is the date the event happens on. */
function datePart(at: string, timeZone: string, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat('en-GB', { ...options, timeZone }).format(new Date(at));
}

function EventRow({ event, past }: { event: ClubEvent; past?: boolean }) {
  const left = Math.max(event.capacity - event.confirmedCount, 0);

  return (
    <Link
      href={`/events/${event.id}`}
      className="flex items-center gap-3 rounded-card border border-border bg-surface p-2.5 transition-colors duration-(--dur-fast) ease-(--ease-out) hover:bg-surface-2"
    >
      <span className="w-12 shrink-0 overflow-hidden rounded-control border border-border bg-surface-2 text-center">
        <span className="block bg-primary py-0.5 text-[0.625rem] font-bold tracking-[0.09em] text-primary-fg uppercase">
          {datePart(event.startsAt, event.timezone, { month: 'short' })}
        </span>
        <span className="block py-0.5 text-lg font-bold tabular-nums text-ink">
          {datePart(event.startsAt, event.timezone, { day: '2-digit' })}
        </span>
      </span>

      <span className="min-w-0 flex-1">
        <span className="block truncate font-semibold text-ink">{event.title}</span>
        <span className="block truncate text-sm tabular-nums text-ink-2">
          {datePart(event.startsAt, event.timezone, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })}
          {' · '}
          {event.venue ?? 'Online'}
        </span>
      </span>

      {past ? (
        <StatusBadge status={event.status} />
      ) : (
        <span className={left === 0 ? 'shrink-0 text-sm tabular-nums text-warn-fg' : 'shrink-0 text-sm tabular-nums text-ink-2'}>
          {left === 0 ? 'Full' : `${left} left`}
        </span>
      )}
    </Link>
  );
}

function EventSection({
  title,
  events,
  clubId,
  empty,
  past,
}: {
  title: string;
  events: ClubEvent[];
  clubId: string;
  empty?: string;
  past?: boolean;
}) {
  // The API sends one row past the preview so this can tell whether there is
  // more without a second count query.
  const more = events.length > CLUB_EVENT_PREVIEW;
  const shown = events.slice(0, CLUB_EVENT_PREVIEW);

  if (shown.length === 0 && !empty) return null;

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-display text-h1 text-ink">{title}</h3>
        {more ? (
          <Link
            href={`/events?club=${clubId}`}
            className="text-sm font-semibold text-primary hover:underline"
          >
            See all
          </Link>
        ) : null}
      </div>

      {shown.length === 0 ? (
        <EmptyState title={empty as string} />
      ) : (
        <ul className="flex flex-col gap-2">
          {shown.map((event) => (
            <li key={event.id}>
              <EventRow event={event} past={past} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex flex-1 flex-col gap-0.5 border-border px-3.5 py-2.5 not-first:border-l">
      <dt className="text-label font-semibold tracking-[0.08em] text-ink-3 uppercase">{label}</dt>
      <dd className="text-h2 font-semibold tabular-nums text-ink">{value}</dd>
    </div>
  );
}

export function ClubDetail({ slug, initialClub }: { slug: string; initialClub: Club | null }) {
  const [club, setClub] = useState<Club | null>(initialClub);
  const [missing, setMissing] = useState(false);

  const load = useCallback(async () => {
    try {
      setClub(await getClubBySlug(slug));
    } catch (err) {
      if (err instanceof ProblemError && err.status === 404) setMissing(true);
      else throw err;
    }
  }, [slug]);

  // Only when the server could not render it: a 404 or a dead API leaves the
  // client to fetch, which is also the path that reports "no such club".
  const fail = useAsyncError();

  useEffect(() => {
    if (!initialClub) load().catch(fail);
  }, [initialClub, load]);

  if (missing) return <EmptyState title="No such club" />;
  if (!club) return <Skeleton className="h-64" />;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col">
        <ClubBanner clubId={club.id} bannerUrl={club.bannerUrl} className="rounded-card" />

        {/* The crest and the name ride up over the banner's foot, so the
            identity is one object rather than a picture with a caption.
            `relative` is load-bearing: the banner is positioned, so without a
            stacking position of its own this row paints UNDER it and the crest
            disappears. */}
        <div className="relative z-10 -mt-9 flex items-end gap-4 px-3 sm:-mt-11 sm:px-5">
          <img
            src={club.logoUrl}
            alt=""
            className="size-19 shrink-0 rounded-card border-[3px] border-bg bg-surface object-cover shadow-[var(--shadow-md)] sm:size-26"
          />
          <div className="min-w-0 flex-1 pb-1">
            <h2 className="truncate font-display text-title text-ink">{club.name}</h2>
            <p className="truncate text-sm text-ink-2">
              {club.departmentName} · {club.category}
            </p>
          </div>
          {/* Only an officer or an Admin can see a club that is not active,
              and for them the state is the first thing worth knowing. */}
          {club.status === 'ACTIVE' ? null : <StatusBadge status={club.status} className="mb-1.5" />}
        </div>
      </header>

      <JoinControl club={club} onChanged={load} />

      <dl className="flex border-y border-border">
        <Stat label="Members" value={club.memberCount} />
        <Stat label="Events run" value={club.eventsRun} />
        <Stat label="Year" value={club.academicYear} />
      </dl>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_19rem]">
        <div className="flex flex-col gap-6">
          <EventSection
            title="Upcoming"
            events={club.upcoming}
            clubId={club.id}
            empty="Nothing scheduled"
          />
          <EventSection title="Past" events={club.past} clubId={club.id} past />

          {/* Phone and tablet have no rail to put About in, so it becomes a
              destination. The rail below replaces it from lg up. */}
          <Link
            href={`/clubs/${slug}/about`}
            className="flex items-center gap-3 rounded-card border border-border bg-surface p-3.5 transition-colors duration-(--dur-fast) ease-(--ease-out) hover:bg-surface-2 lg:hidden"
          >
            <span className="min-w-0 flex-1">
              <span className="block font-display text-h2 text-ink">About</span>
              <span className="block truncate text-sm text-ink-3">
                {club.committee.length === 1
                  ? '1 committee member'
                  : `${club.committee.length} committee members`}
                {' · '}
                {club.departmentName}
              </span>
            </span>
            <CaretRight size={18} weight={ICON_WEIGHT} className="shrink-0 text-ink-3" aria-hidden />
          </Link>
        </div>

        <aside className="hidden flex-col gap-6 lg:flex">
          <AboutBlock club={club} />
          <CommitteeBlock club={club} />
          <DepartmentBlock club={club} />
        </aside>
      </div>
    </div>
  );
}
