'use client';

import type { ClubSummary, EventPage, EventSummary } from '@majlis/contracts';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { EmptyState } from '@/components/EmptyState';
import { LoadMore } from '@/components/LoadMore';
import { StatusBadge } from '@/components/StatusBadge';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { listClubs } from '@/lib/clubs';
import { TimeRange } from '@/components/LocalTime';
import { listEvents } from '@/lib/events';
import { PAGE } from '@/lib/page-size';
import { useCursorPage } from '@/lib/use-cursor-page';
import { useAsyncError } from '@/lib/use-async-error';

const ANY_CLUB = 'any';

function seatsLeft(event: EventSummary): number {
  return Math.max(event.capacity - event.confirmedCount, 0);
}

function EventCard({ event }: { event: EventSummary }) {
  const left = seatsLeft(event);

  return (
    <Link
      href={`/events/${event.id}`}
      className="flex h-full flex-col gap-2 rounded-card border border-border bg-surface p-3 transition-colors duration-(--dur-fast) ease-(--ease-out) hover:bg-surface-2"
    >
      <span className="flex items-center gap-2">
        <img
          src={event.clubLogoUrl}
          alt=""
          className="size-5 shrink-0 rounded-control object-cover"
        />
        <span className="min-w-0 flex-1 truncate text-sm text-ink-2">{event.clubName}</span>
        {event.status === 'PUBLISHED' ? null : <StatusBadge status={event.status} />}
      </span>

      <span className="block font-semibold text-ink">{event.title}</span>

      <TimeRange
        startsAt={event.startsAt}
        endsAt={event.endsAt}
        className="tabular text-sm text-ink-2"
      />

      {/* Pinned to the card foot so seat counts line up across a grid row. */}
      <span className="mt-auto flex items-center justify-between gap-3 text-sm">
        <span className="min-w-0 truncate text-ink-2">{event.venue ?? 'Online'}</span>
        <span className={left === 0 ? 'tabular text-warn-fg' : 'tabular text-ink-2'}>
          {left === 0 ? 'Full' : `${left} of ${event.capacity} left`}
        </span>
      </span>
    </Link>
  );
}

export function EventBrowser({
  initialEvents,
  initialClubs,
  initialClubId,
}: {
  initialEvents: EventPage | null;
  initialClubs: ClubSummary[] | null;
  /** From `?club=`; the server already applied it to `initialEvents`. */
  initialClubId?: string;
}) {
  const [clubs, setClubs] = useState<ClubSummary[]>(initialClubs ?? []);
  const [clubId, setClubId] = useState(initialClubId ?? ANY_CLUB);
  const [q, setQ] = useState('');
  const { items, cursor, show, append } = useCursorPage(initialEvents);
  const [loadingMore, setLoadingMore] = useState(false);
  // The server rendered the unfiltered first page, so the mount run of the
  // filter effect would refetch exactly what is already on screen.
  const seeded = useRef(initialEvents !== null);

  const fail = useAsyncError();

  useEffect(() => {
    if (initialClubs) return;
    listClubs({ limit: 100, status: 'ACTIVE' })
      .then((page) => setClubs(page.items))
      .catch(fail);
  }, [initialClubs]);

  // Refetches from the first page whenever a filter changes, so a stale cursor
  // from the previous filter can never paginate the new result set.
  useEffect(() => {
    if (seeded.current) {
      seeded.current = false;
      return;
    }
    let cancelled = false;
    show(null);
    listEvents({
      limit: PAGE,
      upcoming: true,
      ...(clubId === ANY_CLUB ? {} : { clubId }),
      ...(q.trim() ? { q: q.trim() } : {}),
    })
      .then((page) => {
        if (!cancelled) show(page);
      })
      .catch(fail);
    return () => {
      cancelled = true;
    };
  }, [clubId, q, show]);

  async function loadMore() {
    if (!cursor) return;
    setLoadingMore(true);
    const page = await listEvents({
      limit: PAGE,
      upcoming: true,
      cursor,
      ...(clubId === ANY_CLUB ? {} : { clubId }),
      ...(q.trim() ? { q: q.trim() } : {}),
    });
    append(page);
    setLoadingMore(false);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          aria-label="Search events"
          placeholder="Search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="flex-1"
        />
        {/* A SelectTrigger is a button, which no <label htmlFor> can name. */}
        <Select value={clubId} onValueChange={setClubId}>
          <SelectTrigger aria-label="Filter by club" className="sm:w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY_CLUB}>All clubs</SelectItem>
            {clubs.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {items === null ? (
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState title="No events found" />
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {items.map((event) => (
            <li key={event.id}>
              <EventCard event={event} />
            </li>
          ))}
        </ul>
      )}

      <LoadMore cursor={cursor} onClick={loadMore} busy={loadingMore} />
    </div>
  );
}
