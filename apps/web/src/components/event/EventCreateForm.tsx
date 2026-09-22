'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useState } from 'react';
import { ImageUpload } from '@/components/ImageUpload';
import { OverrideReason } from '@/components/OverrideReason';
import { Button } from '@/components/ui/button';
import { ProblemError } from '@/lib/api';
import { createEvent, mintEventPosterUpload } from '@/lib/events';
import {
  EMPTY_EVENT,
  EventFields,
  toCreateBody,
  validateSchedule,
  type EventFormValues,
} from './EventFields';

/**
 * The create panel, shared by the Admin console's Events section and the club
 * page's `events/new` route, so the form an officer fills in is the same object
 * in both shells.
 */
export function EventCreateForm({
  clubId,
  override,
  onCreated,
}: {
  clubId: string;
  /** Spec 6.1: an Admin holding no role in this club is overriding. */
  override: boolean;
  /** Where the new event opens. Omitted, it opens on its own page, which is
   *  where an officer inside the student shell already works. */
  onCreated?: (eventId: string) => void;
}) {
  const router = useRouter();
  const [values, setValues] = useState<EventFormValues>(EMPTY_EVENT);
  const [reason, setReason] = useState('');
  const [eventId, setEventId] = useState<string | null>(null);
  const [error, setError] = useState<ProblemError | null>(null);
  const [pending, setPending] = useState(false);

  const set = useCallback(
    <K extends keyof EventFormValues>(key: K, value: EventFormValues[K]) =>
      setValues((prev) => ({ ...prev, [key]: value })),
    [],
  );

  // The four window rules the API enforces, applied as the officer types.
  // Submitting into a 422 the form could already name is the whole defect.
  const scheduleBroken = Object.keys(validateSchedule(values)).length > 0;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      // The event's id is minted by the poster route, so the poster's object
      // path exists before the event does. With no poster it is still minted,
      // because the create body carries the id either way.
      const id = eventId ?? (await mintEventPosterUpload(clubId)).eventId;
      const event = await createEvent(clubId, {
        ...toCreateBody(id, values, eventId !== null),
        ...(override ? { overrideReason: reason.trim() } : {}),
      });
      if (onCreated) onCreated(event.id);
      else router.push(`/events/${event.id}`);
    } catch (err) {
      if (err instanceof ProblemError) setError(err);
      else throw err;
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="flex max-w-3xl flex-col gap-8 rounded-card border border-border bg-surface p-5"
    >
      <ImageUpload
        kind="event-poster"
        mint={async () => {
          // A re-pick mints a fresh id: the signed URL is bound to one path.
          const minted = await mintEventPosterUpload(clubId);
          return { signedUrl: minted.signedUrl, publicUrl: minted.publicUrl, id: minted.eventId };
        }}
        onUploaded={(_url, id) => setEventId(id)}
      />

      <EventFields values={values} set={set} disabled={() => false} error={error} />

      {override ? <OverrideReason value={reason} onChange={setReason} /> : null}

      {error && error.errors.length === 0 ? (
        <p role="alert" className="text-sm text-bad-fg">
          {error.detail ?? error.title}
        </p>
      ) : null}

      <Button type="submit" disabled={pending || scheduleBroken} className="h-11 self-start">
        Create event
      </Button>
    </form>
  );
}
