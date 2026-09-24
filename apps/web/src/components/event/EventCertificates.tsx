'use client';

import type { Certificate } from '@majlis/contracts';
import { useCallback, useEffect, useState } from 'react';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { EmptyState } from '@/components/EmptyState';
import { LoadMore } from '@/components/LoadMore';
import { StatusBadge } from '@/components/StatusBadge';
import { Button } from '@/components/ui/button';
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
import { CONSOLE_PAGE } from '@/lib/page-size';
import { useAsyncError } from '@/lib/use-async-error';
import { useCursorPage } from '@/lib/use-cursor-page';

/**
 * One event's certificates, and the controls that issue and correct them.
 *
 * Whoever renders this may manage: `certificate:manage` is the same key for
 * listing as for acting, so a viewer who can read the list holds the controls
 * too. The API re-derives that per request and is the actual gate.
 *
 * Nothing issues on its own (ruled 2026-09-24). Attendance stays correctable
 * until somebody presses Issue, which is why the button is the whole flow.
 */
export function EventCertificates({ eventId }: { eventId: string }) {
  const { items, cursor, show, append } = useCursorPage<Certificate>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issued, setIssued] = useState('');
  const fail = useAsyncError();

  const load = useCallback(async () => {
    show(await eventCertificates(eventId, { limit: CONSOLE_PAGE }));
  }, [eventId, show]);

  useEffect(() => {
    load().catch(fail);
  }, [load, fail]);

  async function issue() {
    setPending(true);
    setError(null);
    try {
      const result = await issueCertificates(eventId);
      // The counts, because a second press is a no-op by design and "nothing
      // happened" and "nothing was left to do" look identical without them.
      setIssued(`Issued ${result.issued}. ${result.total} active.`);
      await load();
    } catch (err) {
      setIssued('');
      setError(err instanceof ProblemError ? (err.detail ?? err.title) : 'That action failed.');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={issue} disabled={pending}>
          Issue certificates
        </Button>
        <span aria-live="polite" className="tabular text-sm text-ink-2 empty:hidden">
          {issued}
        </span>
      </div>

      {error ? (
        <p role="alert" className="text-sm text-bad-fg">
          {error}
        </p>
      ) : null}

      {items === null ? (
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
                        is where the officer is looking. */}
                    <div className="flex justify-end gap-2">
                      {certificate.status === 'ACTIVE' ? (
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
                              await load();
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
                              await load();
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
              if (!cursor) return;
              append(await eventCertificates(eventId, { limit: CONSOLE_PAGE, cursor }));
            }}
          />
        </>
      )}
    </div>
  );
}
