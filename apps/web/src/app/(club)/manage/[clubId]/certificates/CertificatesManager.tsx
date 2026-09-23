'use client';

import type { Certificate, EventSummary, SessionUser } from '@majlis/contracts';
import { useCallback, useEffect, useState } from 'react';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { EmptyState } from '@/components/EmptyState';
import { Field } from '@/components/Field';
import { LoadMore } from '@/components/LoadMore';
import { StatusBadge } from '@/components/StatusBadge';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ProblemError } from '@/lib/api';
import {
  eventCertificates,
  issueCertificates,
  reissueCertificate,
  revokeCertificate,
} from '@/lib/certificates';
import { formatDay } from '@/lib/event-time';
import { listEvents } from '@/lib/events';
import { CONSOLE_PAGE } from '@/lib/page-size';
import { useAsyncError } from '@/lib/use-async-error';
import { useCursorPage } from '@/lib/use-cursor-page';

/**
 * Certificates are read per event, because that is the unit they are issued
 * in and the unit an officer is ever asked about.
 *
 * `certificate:manage` ticks no club role at all (spec 6.1), so an officer
 * sees the list and none of the controls. That is presentation: the API
 * re-derives the same decision per request and is the actual gate.
 */
export function CertificatesManager({
  clubId,
  platformRole,
  initialEvents,
}: {
  clubId: string;
  platformRole: SessionUser['platformRole'];
  initialEvents: EventSummary[] | null;
}) {
  const [events, setEvents] = useState<EventSummary[] | null>(initialEvents);
  const [eventId, setEventId] = useState<string | null>(null);
  const { items, cursor, show, append } = useCursorPage<Certificate>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issued, setIssued] = useState<string>('');
  const fail = useAsyncError();

  const canManage = platformRole === 'ADMIN';

  useEffect(() => {
    if (initialEvents) return;
    listEvents({ clubId, limit: CONSOLE_PAGE })
      .then((page) => setEvents(page.items))
      .catch(fail);
  }, [clubId, initialEvents, fail]);

  const load = useCallback(
    async (id: string) => {
      show(null);
      show(await eventCertificates(id, { limit: CONSOLE_PAGE }));
    },
    [show],
  );

  useEffect(() => {
    if (eventId) load(eventId).catch(fail);
  }, [eventId, load, fail]);

  async function issue(id: string) {
    setPending(true);
    setError(null);
    try {
      const result = await issueCertificates(id);
      // The counts, because a second press is a no-op by design and "nothing
      // happened" and "nothing was left to do" look identical without them.
      setIssued(`Issued ${result.issued}. ${result.total} active.`);
      await load(id);
    } catch (err) {
      setIssued('');
      setError(err instanceof ProblemError ? (err.detail ?? err.title) : 'That action failed.');
    } finally {
      setPending(false);
    }
  }

  if (events === null) return <Skeleton className="h-64 w-full" />;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Event">
          {/* A SelectTrigger is a button, which no <label htmlFor> can name. */}
          <Select value={eventId ?? undefined} onValueChange={setEventId}>
            <SelectTrigger aria-label="Event" className="min-w-64">
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

        {canManage && eventId ? (
          <Button onClick={() => issue(eventId)} disabled={pending}>
            Issue certificates
          </Button>
        ) : null}

        <span aria-live="polite" className="tabular text-sm text-ink-2 empty:hidden">
          {issued}
        </span>
      </div>

      {error ? (
        <p role="alert" className="text-sm text-bad-fg">
          {error}
        </p>
      ) : null}

      {eventId === null ? null : items === null ? (
        <Skeleton className="h-40 w-full" />
      ) : items.length === 0 ? (
        <EmptyState title="No certificates issued" />
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Holder</TableHead>
                <TableHead>Serial</TableHead>
                <TableHead>Issued</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((certificate) => (
                <TableRow key={certificate.id}>
                  <TableCell className="font-medium text-ink">{certificate.holderName}</TableCell>
                  <TableCell className="tabular selectable text-ink-2">
                    {certificate.serialNumber}
                  </TableCell>
                  <TableCell className="tabular text-ink-2">
                    {formatDay(certificate.issuedAt)}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={certificate.status} />
                  </TableCell>
                  <TableCell>
                    {/* Both controls act on an ACTIVE row and neither on a
                        revoked one. Reissue is a correction to a document
                        somebody still holds: it revokes this row and inserts a
                        replacement in one transaction, so it needs a live row
                        to replace. A revoked certificate stays revoked and
                        stays verifiable; the way to give that person a fresh
                        one is to issue the event again.

                        The throw inside onConfirm is deliberate: ConfirmDialog
                        renders it in the API's own words and stays open, which
                        is where the Admin is looking. */}
                    <div className="flex justify-end gap-2">
                      {canManage && certificate.status === 'ACTIVE' ? (
                        <>
                          <ConfirmDialog
                            title={`Reissue ${certificate.holderName}'s certificate?`}
                            confirmLabel="Reissue"
                            reason="required"
                            trigger={
                              <Button size="sm" variant="outline">
                                Reissue
                              </Button>
                            }
                            onConfirm={async (why) => {
                              await reissueCertificate(certificate.id, { reason: why ?? '' });
                              await load(certificate.eventId);
                            }}
                          />
                          <ConfirmDialog
                            title={`Revoke ${certificate.holderName}'s certificate?`}
                            confirmLabel="Revoke"
                            destructive
                            reason="required"
                            trigger={
                              <Button size="sm" variant="destructive">
                                Revoke
                              </Button>
                            }
                            onConfirm={async (why) => {
                              await revokeCertificate(certificate.id, { reason: why ?? '' });
                              await load(certificate.eventId);
                            }}
                          />
                        </>
                      ) : null}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          <LoadMore
            cursor={cursor}
            onClick={async () => {
              if (!cursor || !eventId) return;
              append(await eventCertificates(eventId, { limit: CONSOLE_PAGE, cursor }));
            }}
          />
        </>
      )}
    </div>
  );
}
