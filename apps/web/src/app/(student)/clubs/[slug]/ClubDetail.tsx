'use client';

import type { ClubDetail as Club, EventPage, EventSummary } from '@majlis/contracts';
import { CaretRight, Plus } from '@phosphor-icons/react/ssr';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { ClubBanner } from '@/components/ClubBanner';
import { EmptyState } from '@/components/EmptyState';
import { EventRow } from '@/components/EventRow';
import { LoadMore } from '@/components/LoadMore';
import { useShellSession } from '@/components/shell/shell-session';
import { StatusBadge } from '@/components/StatusBadge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ProblemError } from '@/lib/api';
import { canCreateEvent, clubSectionsFor } from '@/lib/club-sections';
import { cn } from '@/lib/cn';
import { getClubBySlug } from '@/lib/clubs';
import { splitOnEnd } from '@/lib/event-schedule';
import { listEvents } from '@/lib/events';
import { ICON_WEIGHT } from '@/lib/icons';
import { PAGE } from '@/lib/page-size';
import { useAsyncError } from '@/lib/use-async-error';
import { useCursorPage } from '@/lib/use-cursor-page';
import { AboutBlock, CommitteeBlock, DepartmentBlock } from './ClubAbout';
import { JoinControl } from './JoinControl';
import { ManageSheet } from './ManageSheet';

function EventSection({
  title,
  events,
  past,
}: {
  title: string;
  events: EventSummary[];
  past?: boolean;
}) {
  if (events.length === 0) return null;

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-baseline gap-2">
        <h3 className="font-display text-h1 text-ink">{title}</h3>
        <span className="text-sm tabular-nums text-ink-3">{events.length}</span>
      </div>

      <ul className="flex flex-col gap-2">
        {events.map((event) => {
          const left = Math.max(event.capacity - event.confirmedCount, 0);
          return (
            <li key={event.id}>
              <EventRow
                event={event}
                club={false}
                trailing={
                  past ? (
                    <StatusBadge status={event.status} compact />
                  ) : (
                    <span
                      className={cn(
                        'shrink-0 text-[0.8125rem] tabular-nums',
                        left === 0 ? 'text-warn-fg' : 'text-ink-2',
                      )}
                    >
                      {left === 0 ? 'Full' : `${left} left`}
                    </span>
                  )
                }
              />
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * The club's whole programme, drafts and all: no `upcoming` filter, so an
 * officer keeps seeing what is not published yet and everyone keeps seeing
 * what is over. Which half a row belongs in is decided here, because this
 * route has no `past` flag to ask for.
 */
function ClubEvents({
  clubId,
  initialEvents,
}: {
  clubId: string;
  initialEvents: EventPage | null;
}) {
  const { items, cursor, show, append } = useCursorPage<EventSummary>(initialEvents);
  const [busy, setBusy] = useState(false);
  const fail = useAsyncError();

  // Only when the server could not seed this: it resolves the club by slug and
  // needs its id to ask for the events, so the page makes that second call
  // itself. This is the fallback for the path where the first one failed.
  useEffect(() => {
    if (initialEvents) return;
    let cancelled = false;
    listEvents({ clubId, limit: PAGE })
      .then((page) => {
        if (!cancelled) show(page);
      })
      .catch(fail);
    return () => {
      cancelled = true;
    };
  }, [clubId, initialEvents, show]);

  async function loadMore() {
    if (!cursor) return;
    setBusy(true);
    try {
      append(await listEvents({ clubId, limit: PAGE, cursor }));
    } finally {
      setBusy(false);
    }
  }

  if (items === null) return <Skeleton className="h-40" />;
  if (items.length === 0) return <EmptyState title="No events" />;

  const { upcoming, past } = splitOnEnd(items, Date.now());

  return (
    <div className="flex flex-col gap-6">
      <EventSection title="Upcoming" events={upcoming} />
      <EventSection title="Past" events={past} past />
      <LoadMore cursor={cursor} onClick={loadMore} busy={busy} />
    </div>
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

export function ClubDetail({
  slug,
  initialClub,
  initialEvents,
}: {
  slug: string;
  initialClub: Club | null;
  initialEvents: EventPage | null;
}) {
  const [club, setClub] = useState<Club | null>(initialClub);
  const [missing, setMissing] = useState(false);
  const { user } = useShellSession();

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

  const sections = clubSectionsFor(club.viewerClubRoles, user.platformRole);
  const canCreate = canCreateEvent(club.viewerClubRoles, user.platformRole);

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

      {/* Above the stats, and the same row for everybody: a viewer holding
          neither of these two sees exactly the control they saw before. */}
      {sections.length > 0 || canCreate ? (
        <div className="flex flex-wrap items-center gap-2">
          {canCreate ? (
            <Button asChild size="lg" className="h-11">
              <Link href={`/clubs/${slug}/events/new`}>
                <Plus data-icon="inline-start" aria-hidden />
                New event
              </Link>
            </Button>
          ) : null}
          {sections.length > 0 ? <ManageSheet club={club} sections={sections} /> : null}
        </div>
      ) : (
        <JoinControl club={club} onChanged={load} />
      )}

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
          <ClubEvents clubId={club.id} initialEvents={initialEvents} />

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
