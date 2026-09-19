'use client';

import type {
  AssignmentList,
  AttendanceMethod,
  AttendancePage,
  EventDetail,
  EventResponsibility,
  RegistrationPage,
  SessionUser,
  UserSearchItem,
} from '@majlis/contracts';
import { useCallback, useEffect, useState } from 'react';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { EmptyState } from '@/components/EmptyState';
import { Field } from '@/components/Field';
import { LoadMore } from '@/components/LoadMore';
import { ImageUpload } from '@/components/ImageUpload';
import { OverrideReason } from '@/components/OverrideReason';
import { StatusBadge } from '@/components/StatusBadge';
import { UserPicker } from '@/components/UserPicker';
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
import { ProblemError } from '@/lib/api';
import { enumLabel } from '@/lib/enum-label';
import { canEditEventField, type EventField } from '@/lib/event-fields';
import { correctAttendance, listAttendance } from '@/lib/attendance';
import { Moment, TimeRange } from '@/components/LocalTime';
import { needsOverrideReason } from '@/lib/override';
import { PAGE } from '@/lib/page-size';
import { useCursorPage } from '@/lib/use-cursor-page';
import {
  assignResponsibility,
  cancelEvent,
  getEvent,
  listAssignments,
  listRoster,
  mintEventPosterEditUpload,
  publishEvent,
  removeAssignment,
  updateEvent,
} from '@/lib/events';
import {
  EventFields,
  fromEvent,
  toPatchBody,
  validateSchedule,
  type EventFormValues,
} from '../EventFields';
import { useAsyncError } from '@/lib/use-async-error';

const RESPONSIBILITIES: EventResponsibility[] = ['EVENT_LEAD', 'OPERATIONS', 'MARKETING'];

/** enumLabel would render QR_SCAN as "Qr scan", which reads as a typo. */
const METHOD: Record<AttendanceMethod, string> = { QR_SCAN: 'Scan', MANUAL: 'Manual' };

/** Two sections sit behind their own permission. A 403 renders as the section
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

function AssignPanel({
  clubId,
  eventId,
  held,
  overrideReason,
  onChanged,
}: {
  clubId: string;
  eventId: string;
  held: string[];
  overrideReason: string | undefined;
  onChanged: () => Promise<void>;
}) {
  const [picked, setPicked] = useState<UserSearchItem | null>(null);
  const [responsibility, setResponsibility] = useState<EventResponsibility>('EVENT_LEAD');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit() {
    if (!picked) return;
    setPending(true);
    setError(null);
    try {
      await assignResponsibility(eventId, { userId: picked.id, responsibility, overrideReason });
      setPicked(null);
      await onChanged();
    } catch (err) {
      setError(err instanceof ProblemError ? (err.detail ?? err.title) : 'That action failed.');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-card border border-border bg-surface p-4 sm:max-w-md">
      <UserPicker value={picked} onChange={setPicked} exclude={held} clubId={clubId} />
      <Field label="Responsibility">
        <Select
          value={responsibility}
          onValueChange={(v) => setResponsibility(v as EventResponsibility)}
        >
          {/* A SelectTrigger is a button, which no <label htmlFor> can name. */}
          <SelectTrigger aria-label="Responsibility">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {RESPONSIBILITIES.map((r) => (
              <SelectItem key={r} value={r}>
                {enumLabel(r)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      {error ? (
        <p role="alert" className="text-sm text-bad-fg">
          {error}
        </p>
      ) : null}
      <Button onClick={submit} disabled={pending || !picked} className="self-start">
        Assign
      </Button>
    </div>
  );
}

export function EventEditor({
  clubId,
  eventId,
  platformRole,
  initialEvent,
  initialAssignments,
  initialRoster,
  initialAttendance,
}: {
  clubId: string;
  eventId: string;
  platformRole: SessionUser['platformRole'];
  initialEvent: EventDetail | null;
  initialAssignments: AssignmentList | null;
  initialRoster: RegistrationPage | null;
  initialAttendance: AttendancePage | null;
}) {
  const [event, setEvent] = useState<EventDetail | null>(initialEvent);
  const [values, setValues] = useState<EventFormValues | null>(
    initialEvent ? fromEvent(initialEvent) : null,
  );
  const [base, setBase] = useState<EventFormValues | null>(
    initialEvent ? fromEvent(initialEvent) : null,
  );
  const {
    items: assignments,
    cursor: assignmentCursor,
    show: showAssignments,
    append: appendAssignments,
  } = useCursorPage(initialAssignments);
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
  const [error, setError] = useState<ProblemError | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, setPending] = useState(false);

  // getEvent FIRST, then the other three together: reading the event is what
  // calls lifecycle.advance() server-side, and the other three read rows that
  // hop changes. In one Promise.all this showed stale CONFIRMED badges and a
  // pre-hop `expected` count on an event whose check-in had just shut.
  const load = useCallback(async () => {
    const detail = await getEvent(eventId);
    const [assigned, registered, attended] = await Promise.all([
      optional(listAssignments(eventId, { limit: PAGE })),
      optional(listRoster(eventId, { limit: PAGE })),
      optional(listAttendance(eventId, { limit: PAGE })),
    ]);
    setEvent(detail);
    setValues(fromEvent(detail));
    setBase(fromEvent(detail));
    showAssignments(assigned);
    showRoster(registered);
    showAttendance(attended);
    setCounts(attended ? { checkedIn: attended.checkedIn, expected: attended.expected } : null);
  }, [eventId, showAssignments, showRoster, showAttendance]);

  const loadMoreAssignments = useCallback(async () => {
    if (!assignmentCursor) return;
    appendAssignments(await listAssignments(eventId, { limit: PAGE, cursor: assignmentCursor }));
  }, [eventId, assignmentCursor, appendAssignments]);

  const loadMoreRoster = useCallback(async () => {
    if (!rosterCursor) return;
    appendRoster(await listRoster(eventId, { limit: PAGE, cursor: rosterCursor }));
  }, [eventId, rosterCursor, appendRoster]);

  const fail = useAsyncError();

  const loadMoreAttendance = useCallback(async () => {
    if (!attendanceCursor) return;
    appendAttendance(await listAttendance(eventId, { limit: PAGE, cursor: attendanceCursor }));
  }, [eventId, attendanceCursor, appendAttendance]);

  useEffect(() => {
    if (!initialEvent) load().catch(fail);
  }, [initialEvent, load]);

  const set = useCallback(<K extends keyof EventFormValues>(key: K, value: EventFormValues[K]) => {
    setSaved(false);
    setValues((prev) => (prev ? { ...prev, [key]: value } : prev));
  }, []);

  if (!event || !values || !base) return <Skeleton className="h-96 w-full" />;

  const roles = event.viewerClubRoles;
  const can = (field: EventField) => canEditEventField(field, roles, platformRole);
  // Mirrors PERMISSIONS in apps/api/src/auth/permissions.ts. Presentation
  // only: the guard re-derives every one per request.
  const isAdmin = platformRole === 'ADMIN';
  // Spec 6.1: an Admin holding no role in this club is overriding, and every
  // action on this screen has to carry why.
  const override = needsOverrideReason(platformRole, roles);
  const overrideReason = override ? reason.trim() || undefined : undefined;
  const canPublish = isAdmin || roles.includes('LEAD') || roles.includes('VICE_LEAD');
  // The four window rules the API enforces, applied as the officer types.
  // Submitting into a 422 the form could already name is the whole defect.
  const scheduleBroken = Object.keys(validateSchedule(values)).length > 0;
  const canCancel = isAdmin || roles.includes('LEAD');
  // Mirrors 'attendance:correct': an EventAssignment grants the right to scan
  // a queue, never to rewrite the record, so Vice Lead and an assigned
  // operator are both absent. The API also enforces the correction window and
  // the CERTIFIED lock, which this cannot see at all.
  const canCorrect = isAdmin || roles.includes('LEAD') || roles.includes('OPERATIONS');

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

  async function act(fn: () => Promise<EventDetail | void>) {
    setPending(true);
    setError(null);
    try {
      await fn();
      await load();
      setSaved(true);
    } catch (err) {
      if (err instanceof ProblemError) setError(err);
      else throw err;
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-10">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 className="font-display text-title text-ink">{event.title}</h2>
          <TimeRange
            startsAt={event.startsAt}
            endsAt={event.endsAt}
            className="tabular text-sm text-ink-2"
          />
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={event.status} />
          {canPublish && event.status === 'DRAFT' ? (
            <Button
              onClick={() => act(() => publishEvent(event.id, { overrideReason }))}
              disabled={pending}
            >
              Publish
            </Button>
          ) : null}
          {canCancel && event.status !== 'CANCELLED' ? (
            <ConfirmDialog
              title={`Cancel ${event.title}?`}
              confirmLabel="Cancel event"
              destructive
              reason="required"
              trigger={
                <Button variant="destructive" disabled={pending}>
                  Cancel event
                </Button>
              }
              onConfirm={(why) => act(() => cancelEvent(event.id, { reason: why ?? '' }))}
            />
          ) : null}
        </div>
      </header>

      {event.status === 'CANCELLED' && event.cancelledReason ? (
        <p role="alert" className="rounded-card bg-bad-soft px-3 py-2 text-sm text-bad-fg">
          {event.cancelledReason}
        </p>
      ) : null}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void act(async () => {
            await updateEvent(event.id, { ...toPatchBody(values, base, can), overrideReason });
          });
        }}
        className="flex max-w-3xl flex-col gap-8"
      >
        {can('posterUploaded') ? (
          <ImageUpload
            kind="event-poster"
            currentUrl={event.bannerUrl}
            mint={async () => ({ ...(await mintEventPosterEditUpload(event.id)), id: event.id })}
            onUploaded={() =>
              void act(() => updateEvent(event.id, { posterUploaded: true, overrideReason }))
            }
          />
        ) : null}

        <EventFields values={values} set={set} disabled={(field) => !can(field)} error={error} />

        {override ? <OverrideReason value={reason} onChange={setReason} /> : null}

        {error && error.errors.length === 0 ? (
          <p role="alert" className="text-sm text-bad-fg">
            {error.detail ?? error.title}
          </p>
        ) : null}

        <div className="flex items-center gap-3">
          <Button type="submit" disabled={pending || scheduleBroken} className="self-start">
            Save changes
          </Button>
          <span aria-live="polite" className="text-sm text-ink-2 empty:hidden">
            {saved && !error ? 'Saved' : ''}
          </span>
        </div>
      </form>

      {assignments === null ? null : (
        <Section title="Team">
          <AssignPanel
            clubId={clubId}
            eventId={event.id}
            held={assignments.map((a) => a.userId)}
            overrideReason={overrideReason}
            onChanged={load}
          />
          {assignments.length === 0 ? (
            <EmptyState title="Nobody assigned" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Person</TableHead>
                  <TableHead>Responsibility</TableHead>
                  <TableHead>
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {assignments.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="font-medium text-ink">{a.userFullName}</span>
                        <span className="text-label text-ink-2">{a.userEmail}</span>
                      </div>
                    </TableCell>
                    <TableCell>{enumLabel(a.responsibility)}</TableCell>
                    <TableCell>
                      <div className="flex justify-end">
                        <ConfirmDialog
                          title={`Remove ${a.userFullName} from this event?`}
                          confirmLabel="Remove"
                          destructive
                          trigger={
                            <Button variant="destructive" size="sm">
                              Remove
                            </Button>
                          }
                          onConfirm={() =>
                            act(() => removeAssignment(event.id, a.id, { overrideReason }))
                          }
                        />
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <LoadMore cursor={assignmentCursor} onClick={loadMoreAssignments} />
        </Section>
      )}

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
                          <span className="text-label text-ink-2">{row.email}</span>
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
                                <Button size="sm" variant={present ? 'destructive' : 'outline'}>
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
