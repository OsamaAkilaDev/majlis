'use client';

import type { EventDetail as Event } from '@majlis/contracts';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { EmptyState } from '@/components/EmptyState';
import { OverrideReason } from '@/components/OverrideReason';
import { useShellSession } from '@/components/shell/shell-session';
import { StatusBadge } from '@/components/StatusBadge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ProblemError } from '@/lib/api';
import { Moment, TimeRange } from '@/components/LocalTime';
import { eventActionsFor } from '@/lib/event-actions';
import { getEvent, publishEvent } from '@/lib/events';
import { needsOverrideReason } from '@/lib/override';
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
  now,
}: {
  eventId: string;
  initialEvent: Event | null;
  /** The server's clock, so which controls are drawn is the same answer on the
   *  first paint and on hydration. Check-in is the one that turns on it. */
  now: number;
}) {
  const [event, setEvent] = useState<Event | null>(initialEvent);
  const [missing, setMissing] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const { user } = useShellSession();

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

  const actions = eventActionsFor(event, new Date(now), user.platformRole);
  const publish = actions.find((a) => a.key === 'publish');
  // Cancel is not here: it is destructive and rare, so it sits at the foot of
  // the edit screen instead of a row the officer scans past.
  const links = actions.filter((a) => a.path !== null);
  // Spec 6.1: an Admin holding no role in this club is overriding, and
  // publish has to carry why.
  const override = needsOverrideReason(user.platformRole, event.viewerClubRoles);

  async function runPublish() {
    setPublishing(true);
    setActionError(null);
    try {
      await publishEvent(eventId, {
        overrideReason: override ? reason.trim() || undefined : undefined,
      });
      await load();
    } catch (err) {
      setActionError(
        err instanceof ProblemError ? (err.detail ?? err.title) : 'That action failed.',
      );
    } finally {
      setPublishing(false);
    }
  }

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
        <Link
          href={`/clubs/${event.clubSlug}`}
          className="flex w-fit items-center gap-2 text-sm text-ink-2 hover:text-ink hover:underline"
        >
          <img
            src={event.clubLogoUrl}
            alt=""
            className="size-5 shrink-0 rounded-control object-cover"
          />
          <span className="truncate">{event.clubName}</span>
        </Link>
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

      {publish || links.length > 0 ? (
        <div className="flex flex-col gap-2">
          {publish && override ? <OverrideReason value={reason} onChange={setReason} /> : null}
          <div className="flex flex-wrap items-center gap-2">
            {publish ? (
              <Button size="lg" className="h-11" disabled={publishing} onClick={runPublish}>
                {publish.label}
              </Button>
            ) : null}
            {links.map((action) => (
              <Button key={action.key} asChild variant="outline" size="lg" className="h-11">
                <Link href={`/events/${event.id}/${action.path}`}>{action.label}</Link>
              </Button>
            ))}
          </div>
          {actionError ? (
            <p role="alert" className="text-sm text-bad-fg">
              {actionError}
            </p>
          ) : null}
        </div>
      ) : null}

      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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

      <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
        <Fact term="Type">{event.eventType}</Fact>
        <Fact term="Audience">{event.audience}</Fact>
      </dl>
    </div>
  );
}
