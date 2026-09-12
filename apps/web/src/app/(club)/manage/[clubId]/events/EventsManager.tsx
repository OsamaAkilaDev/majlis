'use client';

import type { ClubRole, EventPage, SessionUser } from '@majlis/contracts';
import { Plus } from '@phosphor-icons/react/ssr';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { EmptyState } from '@/components/EmptyState';
import { LoadMore } from '@/components/LoadMore';
import { OverrideReason } from '@/components/OverrideReason';
import { ImageUpload } from '@/components/ImageUpload';
import { StatusBadge } from '@/components/StatusBadge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ProblemError } from '@/lib/api';
import { getClub } from '@/lib/clubs';
import { formatMoment } from '@/lib/event-time';
import { needsOverrideReason } from '@/lib/override';
import { CONSOLE_PAGE as PAGE } from '@/lib/page-size';
import { useCursorPage } from '@/lib/use-cursor-page';
import { createEvent, listEvents, mintEventPosterUpload } from '@/lib/events';
import {
  EMPTY_EVENT,
  EventFields,
  toCreateBody,
  type EventFormValues,
} from './EventFields';

/** Creation needs the whole object, so it is Lead, Vice and Admin only (plan, Task 1). */
function canCreate(roles: readonly ClubRole[], platformRole: SessionUser['platformRole']): boolean {
  return platformRole === 'ADMIN' || roles.includes('LEAD') || roles.includes('VICE_LEAD');
}

function CreatePanel({
  clubId,
  override,
  onCreated,
}: {
  clubId: string;
  override: boolean;
  onCreated: (eventId: string) => void;
}) {
  const [values, setValues] = useState<EventFormValues>(EMPTY_EVENT);
  const [reason, setReason] = useState('');
  const [eventId, setEventId] = useState<string | null>(null);
  const [error, setError] = useState<ProblemError | null>(null);
  const [pending, setPending] = useState(false);

  const set = useCallback(
    <K extends keyof EventFormValues>(key: K, value: EventFormValues[K]) =>
      setValues((prev) => ({ ...prev, [key]: value })),
    [],
  );

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      // The event's id is minted by the poster route, so the poster's object
      // path exists before the event does. With no poster it is still minted,
      // because the create body carries the id either way.
      const id = eventId ?? (await mintEventPosterUpload(clubId)).eventId;
      const event = await createEvent(clubId, {
        ...toCreateBody(id, values, eventId !== null),
        ...(override ? { overrideReason: reason.trim() } : {}),
      });
      onCreated(event.id);
    } catch (err) {
      if (err instanceof ProblemError) setError(err);
      else throw err;
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex max-w-3xl flex-col gap-8 rounded-card border border-border bg-surface p-5">
      <ImageUpload
        kind="event-poster"
        mint={async () => {
          // A re-pick mints a fresh id: the signed URL is bound to one path.
          const minted = await mintEventPosterUpload(clubId);
          return { signedUrl: minted.signedUrl, publicUrl: minted.publicUrl, id: minted.eventId };
        }}
        onUploaded={(_url, id) => setEventId(id)}
      />

      <EventFields values={values} set={set} disabled={() => false} error={error} />

      {override ? <OverrideReason value={reason} onChange={setReason} /> : null}

      {error && error.errors.length === 0 ? (
        <p role="alert" className="text-sm text-bad-fg">
          {error.detail ?? error.title}
        </p>
      ) : null}

      <Button type="submit" disabled={pending} className="self-start">
        Create event
      </Button>
    </form>
  );
}

export function EventsManager({
  clubId,
  platformRole,
  initialRoles,
  initialEvents,
}: {
  clubId: string;
  platformRole: SessionUser['platformRole'];
  initialRoles: ClubRole[] | null;
  initialEvents: EventPage | null;
}) {
  const router = useRouter();
  const [roles, setRoles] = useState<ClubRole[] | null>(initialRoles);
  const { items, cursor, show, append } = useCursorPage(initialEvents);
  const [creating, setCreating] = useState(false);
  const seeded = initialRoles !== null && initialEvents !== null;

  const load = useCallback(async () => {
    const [club, page] = await Promise.all([getClub(clubId), listEvents({ clubId, limit: PAGE })]);
    setRoles(club.viewerClubRoles);
    show(page);
  }, [clubId, show]);

  async function loadMore() {
    if (!cursor) return;
    append(await listEvents({ clubId, limit: PAGE, cursor }));
  }

  useEffect(() => {
    if (!seeded) void load();
  }, [seeded, load]);

  if (roles === null || items === null) return <Skeleton className="h-64 w-full" />;

  return (
    <div className="flex flex-col gap-5">
      {canCreate(roles, platformRole) ? (
        <div className="flex justify-end">
          <Button onClick={() => setCreating((open) => !open)} aria-expanded={creating}>
            <Plus data-icon="inline-start" aria-hidden />
            New event
          </Button>
        </div>
      ) : null}

      {creating ? (
        <CreatePanel
          clubId={clubId}
          override={needsOverrideReason(platformRole, roles)}
          onCreated={(id) => router.push(`/manage/${clubId}/events/${id}`)}
        />
      ) : null}

      {items.length === 0 ? (
        <EmptyState title="No events" />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Event</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Starts</TableHead>
              <TableHead>Seats</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((event) => (
              <TableRow key={event.id}>
                <TableCell>
                  <Link
                    href={`/manage/${clubId}/events/${event.id}`}
                    className="font-medium text-ink hover:underline"
                  >
                    {event.title}
                  </Link>
                </TableCell>
                <TableCell>
                  <StatusBadge status={event.status} />
                </TableCell>
                <TableCell className="tabular text-ink-2">
                  {formatMoment(event.startsAt, event.timezone)}
                </TableCell>
                <TableCell className="tabular">
                  {event.confirmedCount} / {event.capacity}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <LoadMore cursor={cursor} onClick={loadMore} />
    </div>
  );
}
