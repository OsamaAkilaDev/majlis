'use client';

import type { ClubSummary, EventPage, EventStatus, EventSummary, UserListItem } from '@majlis/contracts';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { EmptyState } from '@/components/EmptyState';
import { Field } from '@/components/Field';
import { LoadMore } from '@/components/LoadMore';
import { StatusBadge } from '@/components/StatusBadge';
import { UserPicker } from '@/components/UserPicker';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { ProblemError } from '@/lib/api';
import { listClubs } from '@/lib/clubs';
import { formatMoment } from '@/lib/event-time';
import { listEvents, register } from '@/lib/events';
import { PAGE } from '@/lib/page-size';
import { useCursorPage } from '@/lib/use-cursor-page';

const ALL = 'all';

const STATUSES: EventStatus[] = [
  'DRAFT',
  'PUBLISHED',
  'REGISTRATION_CLOSED',
  'ONGOING',
  'COMPLETED',
  'CERTIFIED',
  'CANCELLED',
];

/**
 * Spec 7.4's override: an Admin registering somebody else. The reason is
 * required because an override with no recorded reason is indistinguishable
 * from a bug in the audit log, and the API refuses the body without it.
 */
function OverrideDialog({
  event,
  onClose,
  onDone,
}: {
  event: EventSummary | null;
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const [picked, setPicked] = useState<UserListItem | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function close() {
    setPicked(null);
    setReason('');
    setError(null);
    onClose();
  }

  async function submit() {
    if (!event || !picked) return;
    setPending(true);
    setError(null);
    try {
      await register(event.id, { userId: picked.id, overrideReason: reason.trim() });
      await onDone();
      close();
    } catch (err) {
      setError(err instanceof ProblemError ? (err.detail ?? err.title) : 'That action failed.');
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={event !== null} onOpenChange={(open) => (open ? null : close())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Register someone for {event?.title ?? 'this event'}</DialogTitle>
        </DialogHeader>
        <UserPicker value={picked} onChange={setPicked} />
        <Field label="Reason">
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} required />
        </Field>
        {error ? (
          <p role="alert" className="text-sm text-bad-fg">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={close} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={pending || !picked || reason.trim().length === 0}>
            Register
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function EventsOverview({
  initialEvents,
  initialClubs,
}: {
  initialEvents: EventPage | null;
  initialClubs: ClubSummary[] | null;
}) {
  const [clubs, setClubs] = useState<ClubSummary[]>(initialClubs ?? []);
  const [clubId, setClubId] = useState(ALL);
  const [status, setStatus] = useState(ALL);
  const [q, setQ] = useState('');
  const { items, setItems, cursor, show, append } = useCursorPage(initialEvents);
  const [overriding, setOverriding] = useState<EventSummary | null>(null);
  // The server rendered the unfiltered first page, so the mount run of the
  // filter effect would refetch exactly what is already on screen.
  const seeded = useRef(initialEvents !== null);

  useEffect(() => {
    if (initialClubs) return;
    void listClubs({ limit: 100 }).then((page) => setClubs(page.items));
  }, [initialClubs]);

  async function load(reset: boolean, from?: string | null) {
    const page = await listEvents({
      limit: PAGE,
      ...(clubId === ALL ? {} : { clubId }),
      ...(status === ALL ? {} : { status: status as EventStatus }),
      ...(q.trim() ? { q: q.trim() } : {}),
      ...(reset || !from ? {} : { cursor: from }),
    });
    (reset ? show : append)(page);
  }

  // Refetches from the first page whenever a filter changes, so a stale cursor
  // from the previous filter can never paginate the new result set.
  useEffect(() => {
    if (seeded.current) {
      seeded.current = false;
      return;
    }
    setItems(null);
    void load(true);
  }, [clubId, status, q]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        <Input
          aria-label="Search events"
          placeholder="Search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="w-full sm:w-56"
        />
        {/* A SelectTrigger is a button, which no <label htmlFor> can name. */}
        <Select value={clubId} onValueChange={setClubId}>
          <SelectTrigger aria-label="Filter by club" className="w-44">
            <SelectValue placeholder="Club" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All clubs</SelectItem>
            {clubs.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger aria-label="Filter by status" className="w-48">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All statuses</SelectItem>
            {STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, ' ')}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {items === null ? (
        <Skeleton className="h-40 w-full" />
      ) : items.length === 0 ? (
        <EmptyState title="No events" />
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Event</TableHead>
                <TableHead>Club</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Starts</TableHead>
                <TableHead>Seats</TableHead>
                <TableHead>
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((event) => (
                <TableRow key={event.id}>
                  <TableCell>
                    <Link
                      href={`/manage/${event.clubId}/events/${event.id}`}
                      className="font-medium text-ink hover:underline"
                    >
                      {event.title}
                    </Link>
                  </TableCell>
                  <TableCell className="text-ink-2">{event.clubName}</TableCell>
                  <TableCell>
                    <StatusBadge status={event.status} />
                  </TableCell>
                  <TableCell className="tabular text-ink-2">
                    {formatMoment(event.startsAt, event.timezone)}
                  </TableCell>
                  <TableCell className="tabular">
                    {event.confirmedCount} / {event.capacity}
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setOverriding(event)}
                        aria-label={`Register someone for ${event.title}`}
                      >
                        Register someone
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <LoadMore cursor={cursor} onClick={() => load(false, cursor)} />
        </>
      )}

      <OverrideDialog
        event={overriding}
        onClose={() => setOverriding(null)}
        onDone={() => load(true)}
      />
    </div>
  );
}
