'use client';

import type { EventSummary } from '@majlis/contracts';
import { useCallback, useEffect, useRef, useState } from 'react';
import { EmptyState } from '@/components/EmptyState';
import { Field } from '@/components/Field';
import { StatusBadge } from '@/components/StatusBadge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { ProblemError } from '@/lib/api';
import { listAttendance, manualCheckIn, scanPass } from '@/lib/attendance';
import { eventTimes } from '@/lib/event-time';
import { listEvents } from '@/lib/events';
import { CONSOLE_PAGE } from '@/lib/page-size';
import { verdictOf, type Verdict } from '@/lib/scan-verdict';
import { useAsyncError } from '@/lib/use-async-error';
import { useViewerZone } from '@/lib/use-viewer-zone';
import { ScanCamera, type CameraState } from './ScanCamera';
import { ScanVerdict } from './ScanVerdict';

/** How long the same code in frame is ignored after it has been answered. */
const REPEAT_MS = 4000;

const CAMERA_MESSAGE: Partial<Record<CameraState, string>> = {
  unsupported: 'This browser cannot scan QR codes.',
  denied: 'The camera is not available.',
};

function ManualForm({
  disabled,
  onSubmit,
}: {
  disabled: boolean;
  onSubmit: (email: string, reason: string) => Promise<boolean>;
}) {
  const [email, setEmail] = useState('');
  const [reason, setReason] = useState('');

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        void onSubmit(email.trim(), reason.trim()).then((ok) => {
          if (ok) setEmail('');
        });
      }}
    >
      <Field label="Email">
        <Input
          type="email"
          inputMode="email"
          autoComplete="off"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="h-12"
        />
      </Field>
      <Field label="Reason">
        <Input
          required
          maxLength={500}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className="h-12"
        />
      </Field>
      {/* text-base, not text-body: tailwind-merge cannot know a custom
          --text-body is a font size, files it under colour, and silently drops
          the variant's text-primary-fg. That shipped at 1.87:1. */}
      <Button type="submit" disabled={disabled} className="h-12 text-base">
        Check in
      </Button>
    </form>
  );
}

/** The check-in screen, spec 9.4. Dark in both themes: a viewfinder in a lit
 *  hall needs a dark surround, and the use scene decides that, not the toggle. */
export function ScanSession({
  clubId,
  initialEvents,
}: {
  clubId: string;
  initialEvents: EventSummary[] | null;
}) {
  const [events, setEvents] = useState<EventSummary[] | null>(initialEvents);
  const [eventId, setEventId] = useState<string | null>(null);
  const [camera, setCamera] = useState<CameraState>('starting');
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [counts, setCounts] = useState<{ checkedIn: number; expected: number } | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const answered = useRef<{ raw: string; at: number } | null>(null);
  const viewerZone = useViewerZone();
  const fail = useAsyncError();

  useEffect(() => {
    if (initialEvents) return;
    listEvents({ clubId, limit: CONSOLE_PAGE })
      .then((page) => setEvents(page.items))
      .catch(fail);
  }, [clubId, initialEvents, fail]);

  // Prewarms the connection, so the first real scan is not also the first call
  // to the API. A 403 here (may scan, may not read the roster) still warms it
  // and simply leaves the counter off.
  const refreshCounts = useCallback(async (id: string) => {
    try {
      const page = await listAttendance(id, { limit: 1 });
      setCounts({ checkedIn: page.checkedIn, expected: page.expected });
    } catch {
      setCounts(null);
    }
  }, []);

  useEffect(() => {
    if (eventId) void refreshCounts(eventId);
  }, [eventId, refreshCounts]);

  // Held while the session is open, released on unmount, so the screen does
  // not sleep in the middle of a queue.
  useEffect(() => {
    if (!eventId) return;
    let sentinel: WakeLockSentinel | null = null;
    let released = false;

    navigator.wakeLock
      ?.request('screen')
      .then((held) => {
        if (released) void held.release().catch(() => {});
        else sentinel = held;
      })
      .catch(() => {

      });

    return () => {
      released = true;
      void sentinel?.release().catch(() => {});
    };
  }, [eventId]);

  const record = useCallback(
    async (id: string, run: () => Promise<Awaited<ReturnType<typeof scanPass>>>) => {
      setPending(true);
      setError(null);
      try {
        const result = await run();
        const next = verdictOf(result);
        setVerdict(next);
        navigator.vibrate?.(next.pattern);
        if (result.result === 'CHECKED_IN') void refreshCounts(id);
        return result.result === 'CHECKED_IN';
      } catch (err) {
        // Spec 7.5's seventh outcome, written by the guard: a fault in the
        // request, never a verdict on a person.
        setError(
          err instanceof ProblemError
            ? (err.detail ?? err.title)
            : 'That check-in could not be sent.',
        );
        return false;
      } finally {
        setPending(false);
      }
    },
    [refreshCounts],
  );

  const onToken = useCallback(
    (raw: string) => {
      if (!eventId) return;
      const last = answered.current;
      // The code stays in frame after being answered. Without this the operator
      // is shown "already checked in" for the person they just let through.
      if (last && last.raw === raw && Date.now() - last.at < REPEAT_MS) return;
      answered.current = { raw, at: Date.now() };
      void record(eventId, () => scanPass(eventId, { token: raw }));
    },
    [eventId, record],
  );

  if (events === null) return <Skeleton className="h-96 w-full" />;

  const event = events.find((e) => e.id === eventId) ?? null;
  const scanning = camera === 'starting' || camera === 'running';
  const showManual = manualOpen || !scanning;

  return (
    // Full bleed over the console's padding. The dark palette comes from the
    // shell, which carries it across the header too.
    <section className="-mx-4 -my-5 flex min-h-[calc(100dvh-3.75rem)] flex-col bg-bg text-ink lg:-mx-8 lg:-my-6">
      {event === null ? (
        <div className="flex flex-col gap-2 p-4">
          <h2 className="font-display text-h1 text-ink">Pick an event</h2>
          {events.length === 0 ? (
            <EmptyState title="No events" />
          ) : (
            events.map((e) => {
              const times = eventTimes(e.startsAt, e.endsAt, e.timezone, viewerZone);
              return (
                <button
                  key={e.id}
                  type="button"
                  onClick={() => setEventId(e.id)}
                  className="flex min-h-14 flex-col items-start gap-1 rounded-card border border-border bg-surface px-4 py-3 text-left hover:bg-surface-2"
                >
                  <span className="flex w-full items-center justify-between gap-3">
                    <span className="min-w-0 truncate font-semibold text-ink">{e.title}</span>
                    <StatusBadge status={e.status} />
                  </span>
                  <span className="tabular text-sm text-ink-2">{times.venue}</span>
                </button>
              );
            })
          )}
        </div>
      ) : (
        <>
          {scanning ? (
            <div className="relative flex-1 overflow-hidden bg-black">
              <ScanCamera
                paused={pending || verdict !== null}
                onToken={onToken}
                onState={setCamera}
              />

              <div className="absolute inset-x-0 top-0 flex items-start justify-between gap-2 p-3">
                <span className="min-w-0 truncate rounded-control bg-black/80 px-2.5 py-1 text-sm text-white">
                  {event.title}
                </span>
                {counts ? (
                  <span className="tabular shrink-0 rounded-control bg-black/80 px-2.5 py-1 text-sm text-white">
                    {counts.checkedIn} / {counts.expected}
                  </span>
                ) : null}
              </div>
            </div>
          ) : (

            <div className="flex shrink-0 flex-col gap-1 border-b border-border p-4">
              <div className="flex items-start justify-between gap-2">
                <span className="min-w-0 truncate font-semibold text-ink">{event.title}</span>
                {counts ? (
                  <span className="tabular shrink-0 text-sm text-ink-2">
                    {counts.checkedIn} / {counts.expected}
                  </span>
                ) : null}
              </div>
              <p className="text-sm text-ink-2">{CAMERA_MESSAGE[camera]}</p>
            </div>
          )}

          {verdict ? (
            <ScanVerdict verdict={verdict} onClear={() => setVerdict(null)} />
          ) : (

            <div className="mt-auto flex flex-col gap-3 border-t border-border p-4 pb-[calc(1rem+var(--safe-b))]">
              {error ? (
                <p role="alert" className="text-sm text-bad-fg">
                  {error}
                </p>
              ) : null}

              {showManual ? (
                <ManualForm
                  disabled={pending}
                  onSubmit={(email, reason) =>
                    record(event.id, () => manualCheckIn(event.id, { email, reason }))
                  }
                />
              ) : null}

              <div className="flex gap-2">
                {scanning ? (
                  <Button
                    variant="outline"
                    className="h-12 flex-1 text-base"
                    aria-expanded={manualOpen}
                    onClick={() => setManualOpen((open) => !open)}
                  >
                    Check in by email
                  </Button>
                ) : null}
                <Button
                  variant="ghost"
                  className="h-12 flex-1 text-base"
                  onClick={() => {
                    setEventId(null);
                    setVerdict(null);
                    setError(null);
                    setCounts(null);
                  }}
                >
                  Change event
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
