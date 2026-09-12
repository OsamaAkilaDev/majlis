'use client';

import type { ClubSummary, EventPage, EventSummary } from '@majlis/contracts';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { EmptyState } from '@/components/EmptyState';
import { StatusBadge } from '@/components/StatusBadge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { listClubs } from '@/lib/clubs';
import { eventTimes } from '@/lib/event-time';
import { listEvents } from '@/lib/events';
import { PAGE } from '@/lib/page-size';

const ANY_CLUB = 'any';

function seatsLeft(event: EventSummary): number {
  return Math.max(event.capacity - event.confirmedCount, 0);
}

function EventCard({ event }: { event: EventSummary }) {
  const times = eventTimes(event.startsAt, event.endsAt, event.timezone);
  const left = seatsLeft(event);

  return (
    <Link
      href={`/events/${event.id}`}
      className="flex h-full flex-col gap-2 rounded-card border border-border bg-surface p-3 transition-colors duration-[--dur-fast] ease-[--ease-out] hover:bg-surface-2"
    >
      <span className="flex items-center gap-2">
        <img src={event.clubLogoUrl} alt="" className="size-5 shrink-0 rounded-control object-cover" />
        <span className="min-w-0 flex-1 truncate text-sm text-ink-2">{event.clubName}</span>
        {event.status === 'PUBLISHED' ? null : <StatusBadge status={event.status} />}
      </span>

      <span className="block font-semibold text-ink">{event.title}</span>

      <span className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-sm text-ink-2">
        <span className="tabular">{times.venue}</span>
        {times.viewer ? <span className="tabular text-ink-3">{times.viewer}</span> : null}
      </span>

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
}: {
  initialEvents: EventPage | null;
  initialClubs: ClubSummary[] | null;
}) {
  const [clubs, setClubs] = useState<ClubSummary[]>(initialClubs ?? []);
  const [clubId, setClubId] = useState(ANY_CLUB);
  const [q, setQ] = useState('');
  const [items, setItems] = useState<EventSummary[] | null>(initialEvents?.items ?? null);
  const [cursor, setCursor] = useState<string | null>(initialEvents?.nextCursor ?? null);
  const [loadingMore, setLoadingMore] = useState(false);
  // The server rendered the unfiltered first page, so the mount run of the
  // filter effect would refetch exactly what is already on screen.
  const seeded = useRef(initialEvents !== null);

  useEffect(() => {
    if (initialClubs) return;
    void listClubs({ limit: 100, status: 'ACTIVE' }).then((page) => setClubs(page.items));
  }, [initialClubs]);

  // Refetches from the first page whenever a filter changes, so a stale cursor
  // from the previous filter can never paginate the new result set.
  useEffect(() => {
    if (seeded.current) {
      seeded.current = false;
      return;
    }
    let cancelled = false;
    setItems(null);
    void listEvents({
      limit: PAGE,
      upcoming: true,
      ...(clubId === ANY_CLUB ? {} : { clubId }),
      ...(q.trim() ? { q: q.trim() } : {}),
    }).then((page) => {
      if (cancelled) return;
      setItems(page.items);
      setCursor(page.nextCursor);
    });
    return () => {
      cancelled = true;
    };
  }, [clubId, q]);

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
    setItems((prev) => [...(prev ?? []), ...page.items]);
    setCursor(page.nextCursor);
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

      {cursor ? (
        <Button variant="outline" onClick={loadMore} disabled={loadingMore} className="self-center">
          Load more
        </Button>
      ) : null}
    </div>
  );
}
