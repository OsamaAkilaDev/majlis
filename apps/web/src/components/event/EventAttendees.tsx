'use client';

import type {
  AttendanceMethod,
  AttendancePage,
  EventDetail,
  RegistrationPage,
  SessionUser,
} from '@majlis/contracts';
import { useCallback, useEffect, useState } from 'react';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { EmptyState } from '@/components/EmptyState';
import { LoadMore } from '@/components/LoadMore';
import { Moment } from '@/components/LocalTime';
import { OverrideReason } from '@/components/OverrideReason';
import { StatusBadge } from '@/components/StatusBadge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ProblemError } from '@/lib/api';
import { correctAttendance, listAttendance } from '@/lib/attendance';
import { getEvent, listRoster } from '@/lib/events';
import { needsOverrideReason } from '@/lib/override';
import { PAGE } from '@/lib/page-size';
import { useAsyncError } from '@/lib/use-async-error';
import { useCursorPage } from '@/lib/use-cursor-page';

/** enumLabel would render QR_SCAN as "Qr scan", which reads as a typo. */
const METHOD: Record<AttendanceMethod, string> = { QR_SCAN: 'Scan', MANUAL: 'Manual' };

/** Each section sits behind its own permission. A 403 renders as the section
 *  not existing rather than an error; the server is the protection either way. */
async function optional<T>(promise: Promise<T>): Promise<T | null> {
  try {
    return await promise;
  } catch (err) {
    if (err instanceof ProblemError && err.status === 403) return null;
    throw err;
  }
}

function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-display text-h1 text-ink">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

/**
 * Who registered and who turned up. `registration:read` admits an EVENT_LEAD
 * or OPERATIONS assignee who must reach this and nothing else, which is why it
 * is a screen of its own rather than a section of the edit form.
 */
export function EventAttendees({
  eventId,
  platformRole,
  initialEvent,
  initialRoster,
  initialAttendance,
}: {
  eventId: string;
  platformRole: SessionUser['platformRole'];
  initialEvent: EventDetail | null;
  initialRoster: RegistrationPage | null;
  initialAttendance: AttendancePage | null;
}) {
  const [event, setEvent] = useState<EventDetail | null>(initialEvent);
  const {
    items: roster,
    cursor: rosterCursor,
    show: showRoster,
    append: appendRoster,
  } = useCursorPage(initialRoster);
  const {
    items: attendance,
    cursor: attendanceCursor,
    show: showAttendance,
    append: appendAttendance,
  } = useCursorPage(initialAttendance);
  // Beside the page, not in it: these are totals for the whole event, not for
  // the page on screen.
  const [counts, setCounts] = useState<{ checkedIn: number; expected: number } | null>(
    initialAttendance
      ? { checkedIn: initialAttendance.checkedIn, expected: initialAttendance.expected }
      : null,
  );
  const [reason, setReason] = useState('');

  // getEvent FIRST, then the two together: reading the event is what calls
  // lifecycle.advance() server-side, and both of these read rows that hop with
  // it. In one Promise.all this showed stale CONFIRMED badges and a pre-hop
  // `expected` count on an event whose check-in had just shut.
  const load = useCallback(async () => {
    const detail = await getEvent(eventId);
    const [registered, attended] = await Promise.all([
      optional(listRoster(eventId, { limit: PAGE })),
      optional(listAttendance(eventId, { limit: PAGE })),
    ]);
    setEvent(detail);
    showRoster(registered);
    showAttendance(attended);
    setCounts(attended ? { checkedIn: attended.checkedIn, expected: attended.expected } : null);
  }, [eventId, showRoster, showAttendance]);

  const loadMoreRoster = useCallback(async () => {
    if (!rosterCursor) return;
    appendRoster(await listRoster(eventId, { limit: PAGE, cursor: rosterCursor }));
  }, [eventId, rosterCursor, appendRoster]);

  const loadMoreAttendance = useCallback(async () => {
    if (!attendanceCursor) return;
    appendAttendance(await listAttendance(eventId, { limit: PAGE, cursor: attendanceCursor }));
  }, [eventId, attendanceCursor, appendAttendance]);

  const fail = useAsyncError();

  useEffect(() => {
    if (!initialEvent) load().catch(fail);
  }, [initialEvent, load]);

  if (!event) return <Skeleton className="h-96 w-full" />;

  const roles = event.viewerClubRoles;
  // Spec 6.1: an Admin holding no role in this club is overriding, and every
  // correction has to carry why.
  const override = needsOverrideReason(platformRole, roles);
  const overrideReason = override ? reason.trim() || undefined : undefined;
  // Mirrors 'attendance:correct': an EventAssignment grants the right to scan
  // a queue, never to rewrite the record, so Vice Lead and an assigned
  // operator are both absent. The API also enforces the correction window and
  // the CERTIFIED lock, which this cannot see at all.
  const canCorrect =
    platformRole === 'ADMIN' || roles.includes('LEAD') || roles.includes('OPERATIONS');

  async function correct(registrationId: string, present: boolean, why: string | undefined) {
    // eventId, not event.id: hoisted, so TypeScript analyses it above the
    // guard that narrows the event and would want a needless assertion.
    await correctAttendance(eventId, registrationId, {
      present,
      reason: why ?? '',
      ...(overrideReason ? { override: { reason: overrideReason } } : {}),
    });
    await load();
  }

  return (
    <div className="flex flex-col gap-10">
      {/* Named, because the Admin console stacks this under the edit form and
          that form carries a reason of its own for a different set of actions. */}
      {override ? (
        <OverrideReason
          value={reason}
          onChange={setReason}
          label="Override reason for a correction"
        />
      ) : null}

      {roster === null ? null : (
        <Section title="Registrations">
          {roster.length === 0 ? (
            <EmptyState title="Nobody registered" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Person</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Waitlist</TableHead>
                  <TableHead>Source</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {roster.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="font-medium text-ink">{r.userFullName}</span>
                        <span className="text-label text-ink-2">{r.userEmail}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={r.status} />
                    </TableCell>
                    <TableCell className="tabular text-ink-2">{r.waitlistPosition ?? ''}</TableCell>
                    <TableCell className="text-ink-2">
                      {r.source === 'ADMIN_OVERRIDE' ? 'Admin override' : 'Self'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <LoadMore cursor={rosterCursor} onClick={loadMoreRoster} />
        </Section>
      )}

      {attendance === null ? null : (
        <Section
          title="Attendance"
          action={
            counts ? (
              <span className="tabular text-h1 text-ink">
                {counts.checkedIn} / {counts.expected}
              </span>
            ) : undefined
          }
        >
          {attendance.length === 0 ? (
            <EmptyState title="Nobody registered" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Person</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Checked in</TableHead>
                  <TableHead>Method</TableHead>
                  <TableHead>
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {attendance.map((row) => {
                  // The attendance record, never the registration status: a
                  // correction deletes the record and the two would disagree
                  // until a refresh.
                  const present = row.checkedInAt !== null;
                  return (
                    <TableRow key={row.id}>
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="font-medium text-ink">{row.fullName}</span>
                          <span className="selectable text-label text-ink-2">{row.email}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={row.registrationStatus} />
                      </TableCell>
                      <TableCell className="tabular text-ink-2">
                        {row.checkedInAt ? <Moment at={row.checkedInAt} /> : null}
                      </TableCell>
                      <TableCell className="text-ink-2">
                        {row.method ? METHOD[row.method] : ''}
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-end">
                          {canCorrect ? (
                            <ConfirmDialog
                              title={`Mark ${row.fullName} ${present ? 'absent' : 'present'}?`}
                              confirmLabel={present ? 'Mark absent' : 'Mark present'}
                              destructive={present}
                              reason="required"
                              trigger={
                                <Button
                                  size="sm"
                                  variant={present ? 'destructive' : 'outline'}
                                  className="h-11"
                                >
                                  {present ? 'Mark absent' : 'Mark present'}
                                </Button>
                              }
                              onConfirm={(why) => correct(row.id, !present, why)}
                            />
                          ) : null}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
          <LoadMore cursor={attendanceCursor} onClick={loadMoreAttendance} />
        </Section>
      )}
    </div>
  );
}
