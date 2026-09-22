'use client';

import type { EventPage, MyRegistrationPage } from '@majlis/contracts';
import { Certificate } from '@phosphor-icons/react/ssr';
import Link from 'next/link';
import { type ReactNode, useEffect, useState } from 'react';
import { EmptyState } from '@/components/EmptyState';
import { EventRow } from '@/components/EventRow';
import { LoadMore } from '@/components/LoadMore';
import { StatusBadge } from '@/components/StatusBadge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/cn';
import { byStart } from '@/lib/event-schedule';
import { listEvents, myRegistrations } from '@/lib/events';
import { ICON_WEIGHT } from '@/lib/icons';
import { PAGE } from '@/lib/page-size';
import { useAsyncError } from '@/lib/use-async-error';
import { useCursorPage } from '@/lib/use-cursor-page';

interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

type Group<T> = ReturnType<typeof useGroup<T>>;

/**
 * One section's rows. The server hands over its first page, so this fetches
 * only when that could not be had, and then only what a reader asks for.
 */
function useGroup<T>(initial: Page<T> | null, fetchPage: (cursor?: string) => Promise<Page<T>>) {
  const { items, cursor, show, append } = useCursorPage(initial);
  const [busy, setBusy] = useState(false);
  const fail = useAsyncError();

  useEffect(() => {
    if (!initial) fetchPage().then(show).catch(fail);
  }, [initial, show]);

  async function more() {
    if (!cursor) return;
    setBusy(true);
    try {
      append(await fetchPage(cursor));
    } finally {
      setBusy(false);
    }
  }

  return { items, cursor, busy, more };
}

/** Gone entirely when it holds nothing: a heading over an empty panel is three
 *  ways of saying the same nothing on a screen that has two other sections. */
function Section<T>({
  title,
  group,
  children,
}: {
  title: string;
  group: Group<T>;
  children: ReactNode;
}) {
  if (group.items === null) return <Skeleton className="h-40" />;
  if (group.items.length === 0) return null;

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-baseline gap-2">
        <h2 className="font-display text-h1 text-ink">{title}</h2>
        {/* A cursor means the list goes on, so what is loaded is a floor. */}
        <span className="text-sm tabular-nums text-ink-3">
          {group.cursor ? `${group.items.length}+` : group.items.length}
        </span>
      </div>

      <ul className="flex flex-col gap-2">{children}</ul>

      <LoadMore cursor={group.cursor} onClick={group.more} busy={group.busy} />
    </section>
  );
}

export function EventGroups({
  registered,
  fromClubs,
  past,
  certifiedEventIds,
}: {
  registered: MyRegistrationPage | null;
  fromClubs: EventPage | null;
  past: MyRegistrationPage | null;
  /** Events the viewer holds a certificate for, off one page of them: the chip
   *  marks what is there, and /profile/certificates is the whole list. */
  certifiedEventIds: string[];
}) {
  const mine = useGroup(registered, (cursor) =>
    myRegistrations({ limit: PAGE, past: false, cursor }),
  );
  const clubs = useGroup(fromClubs, (cursor) =>
    listEvents({ limit: PAGE, upcoming: true, fromMyClubs: true, cursor }),
  );
  const behind = useGroup(past, (cursor) => myRegistrations({ limit: PAGE, past: true, cursor }));

  const groups = [mine, clubs, behind];
  if (groups.every((g) => g.items?.length === 0)) {
    return (
      <EmptyState
        title="Nothing yet"
        action={
          <Button asChild>
            <Link href="/events/discover">Discover events</Link>
          </Button>
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <Section title="Registered" group={mine}>
        {byStart(mine.items ?? [], (r) => r.event.startsAt).map((registration) => (
          <li key={registration.id}>
            <EventRow
              event={registration.event}
              trailing={
                <span className="flex shrink-0 items-center gap-1.5">
                  <StatusBadge status={registration.status} />
                  {registration.waitlistPosition === null ? null : (
                    <span className="text-[0.8125rem] tabular-nums text-ink-2">
                      #{registration.waitlistPosition}
                    </span>
                  )}
                </span>
              }
            />
          </li>
        ))}
      </Section>

      <Section title="From your clubs" group={clubs}>
        {byStart(clubs.items ?? [], (e) => e.startsAt).map((event) => {
          const left = Math.max(event.capacity - event.confirmedCount, 0);
          return (
            <li key={event.id}>
              <EventRow
                event={event}
                trailing={
                  <span
                    className={cn(
                      'shrink-0 text-[0.8125rem] tabular-nums',
                      left === 0 ? 'text-warn-fg' : 'text-ink-2',
                    )}
                  >
                    {left === 0 ? 'Full' : `${left} left`}
                  </span>
                }
              />
            </li>
          );
        })}
      </Section>

      <Section title="Past" group={behind}>
        {byStart(behind.items ?? [], (r) => r.event.startsAt, true).map((registration) => (
          <li key={registration.id}>
            <EventRow
              event={registration.event}
              trailing={
                <span className="flex shrink-0 items-center gap-1.5">
                  {certifiedEventIds.includes(registration.event.id) ? (
                    <span
                      title="Certificate"
                      aria-label="Certificate"
                      className="inline-grid size-6 place-items-center rounded-control bg-ok-soft text-ok-fg"
                    >
                      <Certificate size={14} weight={ICON_WEIGHT} aria-hidden />
                    </span>
                  ) : null}
                  <StatusBadge status={registration.event.status} compact />
                </span>
              }
            />
          </li>
        ))}
      </Section>
    </div>
  );
}
