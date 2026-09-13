'use client';

import type { AuditEntry, AuditListQuery, AuditPage, UserSearchItem } from '@majlis/contracts';
import { useEffect, useRef, useState } from 'react';
import { EmptyState } from '@/components/EmptyState';
import { LoadMore } from '@/components/LoadMore';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { UserPickerDialog } from '@/components/UserPickerDialog';
import { formatMoment } from '@/lib/event-time';
import { CONSOLE_PAGE } from '@/lib/page-size';
import { useAsyncError } from '@/lib/use-async-error';
import { useCursorPage } from '@/lib/use-cursor-page';

const ALL = 'all';

/** Every `entityType` the API writes. A subject, never an actor (spec 3). */
const ENTITY_TYPES = [
  'AttendanceRecord',
  'Certificate',
  'Club',
  'ClubMembership',
  'ClubTeamAppointment',
  'Department',
  'Event',
  'EventAssignment',
  'EventRegistration',
  'QrPass',
  'User',
] as const;

/** Long enough to tell two rows apart, short enough to read across a table. */
function shortId(id: string): string {
  return id.slice(0, 8);
}

function Outcome({ outcome }: { outcome: AuditEntry['outcome'] }) {
  const ok = outcome === 'SUCCESS';
  return (
    <span
      className={
        ok
          ? 'rounded-full bg-ok-soft px-2 py-0.5 text-label font-semibold text-ok-fg'
          : 'rounded-full bg-bad-soft px-2 py-0.5 text-label font-semibold text-bad-fg'
      }
    >
      {ok ? 'Success' : 'Denied'}
    </span>
  );
}

/**
 * The audit log as a console reads it. Read-only: there is no route in the
 * product that writes or deletes one, and the table is append-only by a
 * statement-level trigger.
 *
 * Timestamps render in UTC, which is how they are stored. An audit row has no
 * venue to belong to, and rendering it in the viewer's zone would differ
 * between the server and the browser, which React answers by throwing the
 * whole tree away.
 */
export function AuditTable({
  initial,
  fetchPage,
  clubId,
}: {
  initial: AuditPage | null;
  fetchPage: (query: AuditListQuery) => Promise<AuditPage>;
  /** Present on a club console, absent on the Admin screen. See UserPicker. */
  clubId?: string;
}) {
  const { items, setItems, cursor, show, append } = useCursorPage(initial);
  const [entityType, setEntityType] = useState(ALL);
  const [actor, setActor] = useState<UserSearchItem | null>(null);
  // The server rendered the unfiltered first page, so the mount run of the
  // filter effect would refetch exactly what is already on screen.
  const seeded = useRef(initial !== null);
  const fail = useAsyncError();

  async function load(reset: boolean, from?: string | null) {
    const page = await fetchPage({
      limit: CONSOLE_PAGE,
      ...(entityType === ALL ? {} : { entityType }),
      ...(actor ? { actorUserId: actor.id } : {}),
      ...(reset || !from ? {} : { cursor: from }),
    });
    (reset ? show : append)(page);
  }

  useEffect(() => {
    if (seeded.current) {
      seeded.current = false;
      return;
    }
    setItems(null);
    load(true).catch(fail);
  }, [entityType, actor]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        {/* A SelectTrigger is a button, which no <label htmlFor> can name. */}
        <Select value={entityType} onValueChange={setEntityType}>
          <SelectTrigger aria-label="Filter by entity type" className="w-56">
            <SelectValue placeholder="Entity type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All entity types</SelectItem>
            {ENTITY_TYPES.map((type) => (
              <SelectItem key={type} value={type}>
                {type}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <UserPickerDialog
          trigger={<Button variant="outline">{actor ? actor.fullName : 'Any actor'}</Button>}
          title="Filter by actor"
          confirmLabel="Apply"
          clubId={clubId}
          onSubmit={async (user) => setActor(user)}
        />

        {actor ? (
          <Button variant="ghost" onClick={() => setActor(null)}>
            Clear actor
          </Button>
        ) : null}
      </div>

      {items === null ? (
        <Skeleton className="h-40 w-full" />
      ) : items.length === 0 ? (
        <EmptyState title="No audit entries" />
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When (UTC)</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Entity</TableHead>
                <TableHead>Outcome</TableHead>
                <TableHead>Actor</TableHead>
                <TableHead>Detail</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell className="tabular whitespace-nowrap text-ink-2">
                    {formatMoment(entry.createdAt, 'UTC')}
                  </TableCell>
                  <TableCell className="font-medium text-ink">{entry.action}</TableCell>
                  <TableCell className="text-ink-2">
                    {entry.entityType}
                    <span className="tabular block text-label text-ink-3" title={entry.entityId}>
                      {shortId(entry.entityId)}
                    </span>
                  </TableCell>
                  <TableCell>
                    <Outcome outcome={entry.outcome} />
                  </TableCell>
                  <TableCell className="tabular text-ink-2">
                    {/* AuditLog has no foreign keys by design, so an actor is
                        an id that outlives the account, not a join. */}
                    {entry.actorUserId ? (
                      <span title={entry.actorUserId}>{shortId(entry.actorUserId)}</span>
                    ) : (
                      'System'
                    )}
                  </TableCell>
                  <TableCell>
                    <details className="max-w-md">
                      <summary className="cursor-pointer text-sm text-primary">Detail</summary>
                      {entry.reason ? (
                        <p className="mt-1 text-sm text-ink-2">{entry.reason}</p>
                      ) : null}
                      <pre className="mt-1 overflow-x-auto rounded-control bg-surface-2 p-2 text-label text-ink-2">
                        {JSON.stringify(
                          {
                            before: entry.before,
                            after: entry.after,
                            requestId: entry.requestId,
                            ip: entry.ip,
                          },
                          null,
                          2,
                        )}
                      </pre>
                    </details>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <LoadMore cursor={cursor} onClick={() => load(false, cursor)} />
        </>
      )}
    </div>
  );
}
