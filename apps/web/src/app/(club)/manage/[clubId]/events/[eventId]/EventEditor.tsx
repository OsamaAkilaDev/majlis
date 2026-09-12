'use client';

import type {
  Assignment,
  EventDetail,
  EventResponsibility,
  Registration,
  SessionUser,
  UserListItem,
} from '@majlis/contracts';
import { useCallback, useEffect, useState } from 'react';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { EmptyState } from '@/components/EmptyState';
import { Field } from '@/components/Field';
import { ImageUpload } from '@/components/ImageUpload';
import { StatusBadge } from '@/components/StatusBadge';
import { UserPicker } from '@/components/UserPicker';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ProblemError } from '@/lib/api';
import { canEditEventField, type EventField } from '@/lib/event-fields';
import { eventTimes } from '@/lib/event-time';
import {
  assignResponsibility,
  cancelEvent,
  getEvent,
  listAssignments,
  listRoster,
  mintEventPosterEditUpload,
  publishEvent,
  removeAssignment,
  responsibilityLabel,
  updateEvent,
} from '@/lib/events';
import { EventFields, fromEvent, toPatchBody, type EventFormValues } from '../EventFields';

const RESPONSIBILITIES: EventResponsibility[] = ['EVENT_LEAD', 'OPERATIONS', 'MARKETING'];

/**
 * Two sections read behind their own permission (`event:assign`,
 * `registration:read`). A viewer without it gets a 403, which is the section
 * not existing rather than an error: the server is the protection either way.
 */
async function optional<T>(promise: Promise<T>): Promise<T | null> {
  try {
    return await promise;
  } catch (err) {
    if (err instanceof ProblemError && err.status === 403) return null;
    throw err;
  }
}

function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
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

function AssignPanel({ eventId, held, onChanged }: { eventId: string; held: string[]; onChanged: () => Promise<void> }) {
  const [picked, setPicked] = useState<UserListItem | null>(null);
  const [responsibility, setResponsibility] = useState<EventResponsibility>('EVENT_LEAD');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit() {
    if (!picked) return;
    setPending(true);
    setError(null);
    try {
      await assignResponsibility(eventId, { userId: picked.id, responsibility });
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
      <UserPicker value={picked} onChange={setPicked} exclude={held} />
      <Field label="Responsibility">
        <Select value={responsibility} onValueChange={(v) => setResponsibility(v as EventResponsibility)}>
          {/* A SelectTrigger is a button, which no <label htmlFor> can name. */}
          <SelectTrigger aria-label="Responsibility">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {RESPONSIBILITIES.map((r) => (
              <SelectItem key={r} value={r}>
                {responsibilityLabel(r)}
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
  eventId,
  platformRole,
  initialEvent,
  initialAssignments,
  initialRoster,
}: {
  eventId: string;
  platformRole: SessionUser['platformRole'];
  initialEvent: EventDetail | null;
  initialAssignments: Assignment[] | null;
  initialRoster: Registration[] | null;
}) {
  const [event, setEvent] = useState<EventDetail | null>(initialEvent);
  const [values, setValues] = useState<EventFormValues | null>(
    initialEvent ? fromEvent(initialEvent) : null,
  );
  const [base, setBase] = useState<EventFormValues | null>(
    initialEvent ? fromEvent(initialEvent) : null,
  );
  const [assignments, setAssignments] = useState<Assignment[] | null>(initialAssignments);
  const [roster, setRoster] = useState<Registration[] | null>(initialRoster);
  const [error, setError] = useState<ProblemError | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, setPending] = useState(false);

  // Three independent reads, not a chain: the roster does not depend on the
  // assignments and waiting for one before starting the other cost a whole
  // round trip on every save.
  const load = useCallback(async () => {
    const [detail, assigned, registered] = await Promise.all([
      getEvent(eventId),
      optional(listAssignments(eventId)),
      optional(listRoster(eventId, { limit: 100 })),
    ]);
    setEvent(detail);
    setValues(fromEvent(detail));
    setBase(fromEvent(detail));
    setAssignments(assigned?.items ?? null);
    setRoster(registered?.items ?? null);
  }, [eventId]);

  useEffect(() => {
    if (!initialEvent) void load();
  }, [initialEvent, load]);

  const set = useCallback(
    <K extends keyof EventFormValues>(key: K, value: EventFormValues[K]) => {
      setSaved(false);
      setValues((prev) => (prev ? { ...prev, [key]: value } : prev));
    },
    [],
  );

  if (!event || !values || !base) return <Skeleton className="h-96 w-full" />;

  const roles = event.viewerClubRoles;
  const can = (field: EventField) => canEditEventField(field, roles, platformRole);
  // Mirrors PERMISSIONS in apps/api/src/auth/permissions.ts. Presentation
  // only: the guard re-derives every one of these per request.
  const isAdmin = platformRole === 'ADMIN';
  const canPublish = isAdmin || roles.includes('LEAD') || roles.includes('VICE_LEAD');
  const canCancel = isAdmin || roles.includes('LEAD');
  const times = eventTimes(event.startsAt, event.endsAt, event.timezone);

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
          <p className="tabular text-sm text-ink-2">{times.venue}</p>
          {times.viewer ? <p className="tabular text-sm text-ink-3">{times.viewer}</p> : null}
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={event.status} />
          {canPublish && event.status === 'DRAFT' ? (
            <Button onClick={() => act(() => publishEvent(event.id))} disabled={pending}>
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
              onConfirm={(reason) => act(() => cancelEvent(event.id, { reason: reason ?? '' }))}
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
            await updateEvent(event.id, toPatchBody(values, base, can));
          });
        }}
        className="flex max-w-3xl flex-col gap-8"
      >
        {can('posterUploaded') ? (
          <ImageUpload
            kind="event-poster"
            currentUrl={event.bannerUrl}
            mint={async () => ({ ...(await mintEventPosterEditUpload(event.id)), id: event.id })}
            onUploaded={() => void act(() => updateEvent(event.id, { posterUploaded: true }))}
          />
        ) : null}

        {/* Inputs the viewer's club role may not change are disabled, so an
            officer is not invited to type a change the server will refuse. */}
        <EventFields values={values} set={set} disabled={(field) => !can(field)} error={error} />

        {error && error.errors.length === 0 ? (
          <p role="alert" className="text-sm text-bad-fg">
            {error.detail ?? error.title}
          </p>
        ) : null}

        <div className="flex items-center gap-3">
          <Button type="submit" disabled={pending} className="self-start">
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
            eventId={event.id}
            held={assignments.map((a) => a.userId)}
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
                    <TableCell>{responsibilityLabel(a.responsibility)}</TableCell>
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
                          onConfirm={() => act(() => removeAssignment(event.id, a.id))}
                        />
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Section>
      )}

      {roster === null ? null : (
        <Section title="Attendees">
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
        </Section>
      )}
    </div>
  );
}
