'use client';

import type { EventDetail } from '@majlis/contracts';
import { useState } from 'react';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { StatusBadge } from '@/components/StatusBadge';
import { Button } from '@/components/ui/button';
import { ProblemError } from '@/lib/api';
import { cancelRegistration, register } from '@/lib/events';

type Action =
  | { kind: 'register' | 'waitlist' | 'cancel' }
  | { kind: 'held' }
  | { kind: 'refused'; why: string };

/**
 * What the viewer can do, derived from the event's status, its registration
 * window and their own registration. Club-membership eligibility is not
 * derivable here, so that refusal arrives from the API and is shown verbatim.
 * The API refuses anything this gets wrong; hiding a control is presentation,
 * never protection.
 */
export function decide(event: EventDetail, now: Date): Action {
  const held = event.viewerRegistrationStatus;
  if (held === 'CONFIRMED' || held === 'WAITLISTED') {
    // The API accepts a change only while the event is still in one of these.
    return ['PUBLISHED', 'REGISTRATION_CLOSED', 'CANCELLED'].includes(event.status)
      ? { kind: 'cancel' }
      : { kind: 'held' };
  }
  if (held !== null) return { kind: 'held' };

  if (event.status === 'CANCELLED') return { kind: 'refused', why: 'This event was cancelled' };
  if (event.status !== 'PUBLISHED') {
    return { kind: 'refused', why: 'Registration for this event has closed' };
  }
  if (now < new Date(event.registrationOpensAt)) {
    return { kind: 'refused', why: 'Registration has not opened yet' };
  }
  if (now >= new Date(event.registrationClosesAt)) {
    return { kind: 'refused', why: 'Registration has closed' };
  }

  if (event.confirmedCount >= event.capacity) {
    return event.waitlistEnabled
      ? { kind: 'waitlist' }
      : { kind: 'refused', why: 'This event is full and has no waitlist' };
  }
  return { kind: 'register' };
}

export function RegisterControl({
  event,
  onChanged,
}: {
  event: EventDetail;
  onChanged: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const action = decide(event, new Date());

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await onChanged();
    } catch (err) {
      setError(err instanceof ProblemError ? (err.detail ?? err.title) : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {event.viewerRegistrationStatus ? (
        <div className="flex items-center gap-2">
          <StatusBadge status={event.viewerRegistrationStatus} />
          {event.viewerWaitlistPosition === null ? null : (
            <span className="tabular text-sm text-ink-2">Position {event.viewerWaitlistPosition}</span>
          )}
        </div>
      ) : null}

      {action.kind === 'register' ? (
        <Button onClick={() => run(() => register(event.id))} disabled={busy}>
          Register
        </Button>
      ) : null}

      {action.kind === 'waitlist' ? (
        <Button onClick={() => run(() => register(event.id))} disabled={busy}>
          Join waitlist
        </Button>
      ) : null}

      {action.kind === 'cancel' ? (
        <ConfirmDialog
          title={`Cancel your place at ${event.title}?`}
          confirmLabel="Cancel registration"
          destructive
          trigger={
            <Button variant="outline" disabled={busy}>
              Cancel registration
            </Button>
          }
          onConfirm={() => run(() => cancelRegistration(event.id))}
        />
      ) : null}

      {/* A disabled control needs an accessible name carrying the reason, or
          the refusal exists only in the layout and a screen reader user learns
          nothing about why they cannot act. */}
      {action.kind === 'refused' ? (
        <Button disabled aria-label={action.why}>
          Register
        </Button>
      ) : null}

      {error ? (
        <p role="alert" className="text-sm text-bad-fg">
          {error}
        </p>
      ) : null}
    </div>
  );
}
