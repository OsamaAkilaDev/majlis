'use client';

import type {
  AssignmentList,
  EventDetail,
  EventResponsibility,
  SessionUser,
  UserSearchItem,
} from '@majlis/contracts';
import { useCallback, useEffect, useState } from 'react';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { EmptyState } from '@/components/EmptyState';
import { Field } from '@/components/Field';
import { ImageUpload } from '@/components/ImageUpload';
import { LoadMore } from '@/components/LoadMore';
import { TimeRange } from '@/components/LocalTime';
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
import { eventActionsFor } from '@/lib/event-actions';
import { canEditEventField, type EventField } from '@/lib/event-fields';
import {
  assignResponsibility,
  cancelEvent,
  getEvent,
  listAssignments,
  mintEventPosterEditUpload,
  publishEvent,
  removeAssignment,
  updateEvent,
} from '@/lib/events';
import { needsOverrideReason } from '@/lib/override';
import { PAGE } from '@/lib/page-size';
import { useAsyncError } from '@/lib/use-async-error';
import { useCursorPage } from '@/lib/use-cursor-page';
import {
  EventFields,
  fromEvent,
  toPatchBody,
  validateSchedule,
  type EventFormValues,
} from './EventFields';

const RESPONSIBILITIES: EventResponsibility[] = ['EVENT_LEAD', 'OPERATIONS', 'MARKETING'];

/** The assignment roster sits behind its own permission. A 403 renders as the
 *  section not existing rather than an error; the server is the protection. */
async function optional<T>(promise: Promise<T>): Promise<T | null> {
  try {
    return await promise;
  } catch (err) {
    if (err instanceof ProblemError && err.status === 403) return null;
    throw err;
  }
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
      <Button onClick={submit} disabled={pending || !picked} className="h-11 self-start">
        Assign
      </Button>
    </div>
  );
}

/**
 * Everything an event's own officers write: the fields, the poster, publish,
 * cancel and the assignment roster. Assignments belong here and not with the
 * attendee roster because `event:assign` is Lead and Vice Lead, the same
 * audience as publish and cancel, whereas `registration:read` admits an
 * assignee who must reach the roster and nothing else. Putting the two
 * together would hand the person who was just assigned the control that
 * assigns people.
 */
export function EventForm({
  eventId,
  platformRole,
  initialEvent,
  initialAssignments,
}: {
  eventId: string;
  platformRole: SessionUser['platformRole'];
  initialEvent: EventDetail | null;
  initialAssignments: AssignmentList | null;
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
  const [reason, setReason] = useState('');
  const [error, setError] = useState<ProblemError | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, setPending] = useState(false);

  // getEvent FIRST: reading the event is what calls lifecycle.advance()
  // server-side, and the assignment rows hop with it.
  const load = useCallback(async () => {
    const detail = await getEvent(eventId);
    const assigned = await optional(listAssignments(eventId, { limit: PAGE }));
    setEvent(detail);
    setValues(fromEvent(detail));
    setBase(fromEvent(detail));
    showAssignments(assigned);
  }, [eventId, showAssignments]);

  const loadMoreAssignments = useCallback(async () => {
    if (!assignmentCursor) return;
    appendAssignments(await listAssignments(eventId, { limit: PAGE, cursor: assignmentCursor }));
  }, [eventId, assignmentCursor, appendAssignments]);

  const fail = useAsyncError();

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
  // Spec 6.1: an Admin holding no role in this club is overriding, and every
  // action on this screen has to carry why.
  const override = needsOverrideReason(platformRole, roles);
  const overrideReason = override ? reason.trim() || undefined : undefined;
  // The one mirror of the permission matrix, the same one the event page draws
  // its controls from, rather than a second copy of two of its rules. Both
  // keys this screen reads turn on status alone, so `new Date()` cannot make
  // the server's render and the browser's disagree; check-in is the key that
  // reads the clock and it is not a control here.
  const actions = eventActionsFor(event, new Date(), platformRole).map((a) => a.key);
  // The four window rules the API enforces, applied as the officer types.
  // Submitting into a 422 the form could already name is the whole defect.
  const scheduleBroken = Object.keys(validateSchedule(values)).length > 0;

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
          {actions.includes('publish') ? (
            <Button
              onClick={() => act(() => publishEvent(event.id, { overrideReason }))}
              disabled={pending}
              className="h-11"
            >
              Publish
            </Button>
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
          <Button type="submit" disabled={pending || scheduleBroken} className="h-11 self-start">
            Save changes
          </Button>
          <span aria-live="polite" className="text-sm text-ink-2 empty:hidden">
            {saved && !error ? 'Saved' : ''}
          </span>
        </div>
      </form>

      {assignments === null ? null : (
        <section className="flex flex-col gap-3">
          <h2 className="font-display text-h1 text-ink">Team</h2>
          <AssignPanel
            clubId={event.clubId}
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
                            <Button variant="destructive" size="sm" className="h-11">
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
        </section>
      )}

      {/* At the foot, away from the row: destructive and rare. */}
      {actions.includes('cancel') ? (
        <div className="border-t border-border pt-6">
          <ConfirmDialog
            title={`Cancel ${event.title}?`}
            confirmLabel="Cancel event"
            destructive
            reason="required"
            trigger={
              <Button variant="destructive" disabled={pending} className="h-11">
                Cancel event
              </Button>
            }
            onConfirm={(why) => act(() => cancelEvent(event.id, { reason: why ?? '' }))}
          />
        </div>
      ) : null}
    </div>
  );
}
