'use client';

import type { EventSummary } from '@majlis/contracts';
import { useEffect, useState } from 'react';
import { EventCertificates } from '@/components/event/EventCertificates';
import { Field } from '@/components/Field';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { listEvents } from '@/lib/events';
import { CONSOLE_PAGE } from '@/lib/page-size';
import { useAsyncError } from '@/lib/use-async-error';

/**
 * Certificates are read per event, because that is the unit they are issued
 * in and the unit anybody is ever asked about. This is the club-wide way in;
 * each finished event's own page is the other.
 */
export function CertificatesManager({
  clubId,
  initialEvents,
}: {
  clubId: string;
  initialEvents: EventSummary[] | null;
}) {
  const [events, setEvents] = useState<EventSummary[] | null>(initialEvents);
  const [eventId, setEventId] = useState<string | null>(null);
  const fail = useAsyncError();

  useEffect(() => {
    if (initialEvents) return;
    listEvents({ clubId, limit: CONSOLE_PAGE })
      .then((page) => setEvents(page.items))
      .catch(fail);
  }, [clubId, initialEvents, fail]);

  if (events === null) return <Skeleton className="h-64 w-full" />;

  return (
    <div className="flex flex-col gap-5">
      <Field label="Event">
        {/* A SelectTrigger is a button, which no <label htmlFor> can name. */}
        <Select value={eventId ?? undefined} onValueChange={setEventId}>
          <SelectTrigger aria-label="Event" className="min-w-64 self-start">
            <SelectValue placeholder="Pick an event" />
          </SelectTrigger>
          <SelectContent>
            {events.map((event) => (
              <SelectItem key={event.id} value={event.id}>
                {event.title}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      {/* Keyed, so switching events starts from an empty list rather than
          showing the last event's rows under the new title. */}
      {eventId ? <EventCertificates key={eventId} eventId={eventId} /> : null}
    </div>
  );
}
