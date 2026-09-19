'use client';

import type { EventDetail as Event } from '@majlis/contracts';
import { useCallback, useEffect, useState } from 'react';
import { EmptyState } from '@/components/EmptyState';
import { StatusBadge } from '@/components/StatusBadge';
import { Skeleton } from '@/components/ui/skeleton';
import { ProblemError } from '@/lib/api';
import { Moment, TimeRange } from '@/components/LocalTime';
import { getEvent } from '@/lib/events';
import { RegisterControl } from './RegisterControl';
import { useAsyncError } from '@/lib/use-async-error';

/** A <dl> may only hold dt/dd groups, so a Fact is one flat div child of it,
 *  never wrapped in a second layout div. */
function Fact({
  term,
  span,
  children,
}: {
  term: string;
  span?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={span ? 'col-span-2' : undefined}>
      <dt className="text-sm text-ink-2">{term}</dt>
      <dd className="text-ink">{children}</dd>
    </div>
  );
}

export function EventDetail({
  eventId,
  initialEvent,
}: {
  eventId: string;
  initialEvent: Event | null;
}) {
  const [event, setEvent] = useState<Event | null>(initialEvent);
  const [missing, setMissing] = useState(false);

  const load = useCallback(async () => {
    try {
      setEvent(await getEvent(eventId));
    } catch (err) {
      if (err instanceof ProblemError && err.status === 404) setMissing(true);
      else throw err;
    }
  }, [eventId]);

  // Only when the server could not render it: a 404 or a dead API leaves the
  // client to fetch, which is also the path that reports "no such event".
  const fail = useAsyncError();

  useEffect(() => {
    if (!initialEvent) load().catch(fail);
  }, [initialEvent, load]);

  if (missing) return <EmptyState title="No such event" />;
  if (!event) return <Skeleton className="h-64" />;

  return (
    <div className="flex flex-col gap-5">
      {event.bannerUrl ? (
        <img
          src={event.bannerUrl}
          alt=""
          className="aspect-video w-full max-w-full rounded-card object-cover"
        />
      ) : null}

      <div className="flex flex-col gap-1">
        {/* Not a link: the student club route resolves by slug, and an event
            carries its club's name and logo but not its slug. */}
        <p className="flex items-center gap-2 text-sm text-ink-2">
          <img
            src={event.clubLogoUrl}
            alt=""
            className="size-5 shrink-0 rounded-control object-cover"
          />
          <span className="truncate">{event.clubName}</span>
        </p>
        <h2 className="font-display text-display text-ink">{event.title}</h2>
        <p className="text-ink-2">{event.summary}</p>
        {event.status === 'PUBLISHED' ? null : (
          <span className="mt-1 self-start">
            <StatusBadge status={event.status} />
          </span>
        )}
      </div>

      {event.status === 'CANCELLED' && event.cancelledReason ? (
        <p role="alert" className="rounded-card bg-bad-soft px-3 py-2 text-sm text-bad-fg">
          {event.cancelledReason}
        </p>
      ) : null}

      <dl className="grid grid-cols-2 gap-3">
        <Fact term="When" span>
          <TimeRange startsAt={event.startsAt} endsAt={event.endsAt} className="block tabular" />
        </Fact>
        <Fact term="Where" span>
          {event.venue ?? (
            <a href={event.onlineUrl ?? '#'} className="underline underline-offset-4">
              {event.onlineUrl ?? 'Online'}
            </a>
          )}
        </Fact>
        <Fact term="Seats">
          <span className="tabular">
            {event.confirmedCount} of {event.capacity}
          </span>
        </Fact>
        <Fact term="Registration closes">
          <Moment at={event.registrationClosesAt} className="tabular text-sm" />
        </Fact>
      </dl>

      <RegisterControl event={event} onChanged={load} />

      <p className="whitespace-pre-line text-ink">{event.description}</p>

      <dl className="grid grid-cols-2 gap-3 text-sm">
        <Fact term="Type">{event.eventType}</Fact>
        <Fact term="Audience">{event.audience}</Fact>
      </dl>
    </div>
  );
}
