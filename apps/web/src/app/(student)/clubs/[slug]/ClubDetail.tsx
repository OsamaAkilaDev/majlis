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
import { useViewerZone } from '@/lib/use-viewer-zone';
import { cn } from '@/lib/cn';
import { getClubBySlug } from '@/lib/clubs';
import { ICON_WEIGHT } from '@/lib/icons';
import { useAsyncError } from '@/lib/use-async-error';
import { AboutBlock, CommitteeBlock, DepartmentBlock } from './ClubAbout';
import { JoinControl } from './JoinControl';

/** One piece of an instant, on the viewer's own clock. Blank until the zone is
 *  known, because the server's is not it. */
function datePart(
  at: string,
  timeZone: string | undefined,
  options: Intl.DateTimeFormatOptions,
  locale = 'en-GB',
): string {
  if (!timeZone) return ' ';
  return new Intl.DateTimeFormat(locale, { ...options, timeZone }).format(new Date(at));
}

function EventRow({ event, past }: { event: ClubEvent; past?: boolean }) {
  const left = Math.max(event.capacity - event.confirmedCount, 0);
  const zone = useViewerZone();

  return (
    <Link
      href={`/events/${event.id}`}
      className="flex items-center gap-3 rounded-card border border-border bg-surface p-2.5 transition-colors duration-(--dur-fast) ease-(--ease-out) hover:bg-surface-2"
    >
      <span className="w-11 shrink-0 overflow-hidden rounded-control border border-border bg-surface-2 text-center">
        <span className="block bg-primary py-0.5 text-[0.5625rem] font-bold tracking-[0.06em] text-primary-fg uppercase">
          {datePart(event.startsAt, zone, { month: 'short' })}
        </span>
        <span className="block py-0.5 text-base font-bold tabular-nums text-ink">
          {datePart(event.startsAt, zone, { day: '2-digit' })}
        </span>
      </span>

      <span className="min-w-0 flex-1">
        {/* Two lines before it gives up: the title is what the row is for. */}
        <span className="block font-semibold text-ink line-clamp-2">{event.title}</span>
        <span className="block truncate text-sm tabular-nums text-ink-2">
          {datePart(
            event.startsAt,
            zone,
            { hour: 'numeric', minute: '2-digit', hour12: true },
            'en-US',
          )}
          {' · '}
          {event.venue ?? 'Online'}
        </span>
      </span>

      {past ? (
        <StatusBadge status={event.status} compact />
      ) : (
        <span
          className={cn(
            'shrink-0 text-sm tabular-nums',
            left === 0 ? 'text-warn-fg' : 'text-ink-2',
          )}
        >
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

/** "2026/2027" -> "2026/27". The full form does not fit a third of a 320px
 *  screen, and a year clipped to "2026/2..." says less than the short one. */
function shortYear(value: string): string {
  return value.replace(/^(\d{4})\/\d{2}(\d{2})$/, '$1/$2');
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-0.5 border-border px-2.5 py-2.5 not-first:border-l sm:px-3.5">
      {/* One line each, or three stats sit at three different heights. */}
      <dt className="truncate text-[0.625rem] font-semibold tracking-[0.06em] text-ink-3 uppercase sm:text-label sm:tracking-[0.08em]">
        {label}
      </dt>
      <dd className="truncate text-base font-semibold tabular-nums text-ink sm:text-h2">{value}</dd>
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
        {/* Stacked below sm, side by side above it. The crest still rides up
            over the banner either way, but the name does not: on a narrow
            screen the banner is only 112px tall, so a name beside the crest
            lands inside the artwork and turns dark text on a dark ground. */}
        <div className="relative z-10 -mt-8 flex flex-col gap-2 px-3 sm:-mt-11 sm:flex-row sm:items-end sm:gap-4 sm:px-5">
          <img
            src={club.logoUrl}
            alt=""
            className="size-16 shrink-0 rounded-card border-[3px] border-bg bg-surface object-cover shadow-[var(--shadow-md)] sm:size-22 lg:size-26"
          />

          <div className="flex min-w-0 flex-1 items-end gap-3 sm:pb-1">
            <div className="min-w-0 flex-1">
              {/* Wraps rather than truncates: a club's name is the one thing on
                  this page nobody should have to guess at. */}
              <h2 className="font-display text-h1 text-ink text-balance sm:text-title">
                {club.name}
              </h2>
              <p className="truncate text-sm text-ink-2">
                {club.departmentName} · {club.category}
              </p>
            </div>
            {/* Only an officer or an Admin can see a club that is not active,
                and for them the state is the first thing worth knowing. */}
            {club.status === 'ACTIVE' ? null : (
              <StatusBadge status={club.status} className="mb-1" />
            )}
          </div>
        </div>
      </header>

      <JoinControl club={club} onChanged={load} />

      <dl className="flex border-y border-border">
        <Stat label="Members" value={club.memberCount} />
        <Stat label="Events" value={club.eventsRun} />
        <Stat label="Year" value={shortYear(club.academicYear)} />
      </dl>

      {/* `grid-cols-1` is load-bearing below lg. With no template at all the
          single implicit track is `auto`, which sizes to max-content, so one
          long venue line pushed the whole column past a 320px screen. */}
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_19rem]">
        <div className="flex min-w-0 flex-col gap-6">
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
            <CaretRight
              size={18}
              weight={ICON_WEIGHT}
              className="shrink-0 text-ink-3"
              aria-hidden
            />
          </Link>
        </div>

        <aside className="hidden min-w-0 flex-col gap-6 lg:flex">
          <AboutBlock club={club} />
          <CommitteeBlock club={club} />
          <DepartmentBlock club={club} />
        </aside>
      </div>
    </div>
  );
}
