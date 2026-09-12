'use client';

import { Field } from '@/components/Field';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import type { ProblemError } from '@/lib/api';
import type { CreateEventBody, EventDetail, PatchEventBody } from '@majlis/contracts';
import type { EventField } from '@/lib/event-fields';
import { fromDateTimeLocal, toDateTimeLocal } from '@/lib/event-time';

/**
 * Every writable field of an event, shared by the create panel and the editor
 * so the two cannot drift into different forms of the same object. Strings
 * throughout: an <input> holds text, and the caller converts on submit.
 */
export interface EventFormValues {
  title: string;
  summary: string;
  description: string;
  eventType: string;
  audience: string;
  venue: string;
  onlineUrl: string;
  timezone: string;
  startsAt: string;
  endsAt: string;
  registrationOpensAt: string;
  registrationClosesAt: string;
  checkInOpensAt: string;
  checkInClosesAt: string;
  capacity: string;
  waitlistEnabled: boolean;
  requiresClubMembership: boolean;
  certificateEnabled: boolean;
  certificateTitle: string;
  certificateSignatory: string;
}

export const EMPTY_EVENT: EventFormValues = {
  title: '',
  summary: '',
  description: '',
  eventType: '',
  audience: '',
  venue: '',
  onlineUrl: '',
  timezone: 'Asia/Dubai',
  startsAt: '',
  endsAt: '',
  registrationOpensAt: '',
  registrationClosesAt: '',
  checkInOpensAt: '',
  checkInClosesAt: '',
  capacity: '30',
  waitlistEnabled: true,
  requiresClubMembership: false,
  certificateEnabled: false,
  certificateTitle: '',
  certificateSignatory: '',
};

/** The runtime's own tz database, so a zone the server cannot resolve cannot be chosen. */
const ZONES = Intl.supportedValuesOf('timeZone');

function Group({ legend, children }: { legend: string; children: React.ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-4">
      <legend className="mb-2 font-display text-h2 text-ink">{legend}</legend>
      {children}
    </fieldset>
  );
}

export function EventFields({
  values,
  set,
  disabled,
  error,
}: {
  values: EventFormValues;
  set: <K extends keyof EventFormValues>(key: K, value: EventFormValues[K]) => void;
  /** Presentation only: the server re-derives the same decision per request. */
  disabled: (field: EventField) => boolean;
  error: ProblemError | null;
}) {
  const text = (key: keyof EventFormValues & EventField, label: string, required = false) => (
    <Field label={label} error={error?.fieldError(key)}>
      <Input
        value={values[key] as string}
        onChange={(e) => set(key, e.target.value as EventFormValues[typeof key])}
        disabled={disabled(key)}
        required={required}
      />
    </Field>
  );

  const moment = (key: keyof EventFormValues & EventField, label: string, required = false) => (
    <Field label={label} error={error?.fieldError(key)}>
      <Input
        type="datetime-local"
        value={values[key] as string}
        onChange={(e) => set(key, e.target.value as EventFormValues[typeof key])}
        disabled={disabled(key)}
        required={required}
      />
    </Field>
  );

  const toggle = (key: keyof EventFormValues & EventField, label: string) => (
    <Field label={label} error={error?.fieldError(key)}>
      <input
        type="checkbox"
        checked={values[key] as boolean}
        onChange={(e) => set(key, e.target.checked as EventFormValues[typeof key])}
        disabled={disabled(key)}
        className="size-5 self-start"
      />
    </Field>
  );

  return (
    <div className="flex flex-col gap-8">
      <Group legend="Details">
        {text('title', 'Title', true)}
        {text('summary', 'Summary', true)}
        <Field label="Description" error={error?.fieldError('description')}>
          <Textarea
            value={values.description}
            onChange={(e) => set('description', e.target.value)}
            disabled={disabled('description')}
            rows={6}
            required
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          {text('eventType', 'Type', true)}
          {text('audience', 'Audience', true)}
        </div>
      </Group>

      <Group legend="Place">
        <div className="grid gap-4 sm:grid-cols-2">
          {text('venue', 'Venue')}
          {text('onlineUrl', 'Online URL')}
        </div>
        <Field label="Time zone" error={error?.fieldError('timezone')}>
          <Select
            value={values.timezone}
            onValueChange={(v) => set('timezone', v)}
            disabled={disabled('timezone')}
          >
            {/* A SelectTrigger is a button, which no <label htmlFor> can name. */}
            <SelectTrigger aria-label="Time zone" className="sm:w-72">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ZONES.map((zone) => (
                <SelectItem key={zone} value={zone}>
                  {zone}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </Group>

      <Group legend="Schedule">
        <div className="grid gap-4 sm:grid-cols-2">
          {moment('startsAt', 'Starts', true)}
          {moment('endsAt', 'Ends', true)}
          {moment('registrationOpensAt', 'Registration opens', true)}
          {moment('registrationClosesAt', 'Registration closes', true)}
          {moment('checkInOpensAt', 'Check-in opens')}
          {moment('checkInClosesAt', 'Check-in closes')}
        </div>
      </Group>

      <Group legend="Capacity">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Capacity" error={error?.fieldError('capacity')}>
            <Input
              type="number"
              min={1}
              value={values.capacity}
              onChange={(e) => set('capacity', e.target.value)}
              disabled={disabled('capacity')}
              required
            />
          </Field>
          {toggle('waitlistEnabled', 'Waitlist')}
          {toggle('requiresClubMembership', 'Members only')}
        </div>
      </Group>

      <Group legend="Certificate">
        {toggle('certificateEnabled', 'Issue certificates')}
        <div className="grid gap-4 sm:grid-cols-2">
          {text('certificateTitle', 'Certificate title')}
          {text('certificateSignatory', 'Signatory')}
        </div>
      </Group>
    </div>
  );
}

const DATETIME_KEYS = [
  'startsAt',
  'endsAt',
  'registrationOpensAt',
  'registrationClosesAt',
  'checkInOpensAt',
  'checkInClosesAt',
] as const;

/** Empty text means "no value" for the four nullable columns. */
const NULLABLE_KEYS = ['venue', 'onlineUrl', 'certificateTitle', 'certificateSignatory'] as const;

export function fromEvent(event: EventDetail): EventFormValues {
  return {
    title: event.title,
    summary: event.summary,
    description: event.description,
    eventType: event.eventType,
    audience: event.audience,
    venue: event.venue ?? '',
    onlineUrl: event.onlineUrl ?? '',
    timezone: event.timezone,
    startsAt: toDateTimeLocal(event.startsAt),
    endsAt: toDateTimeLocal(event.endsAt),
    registrationOpensAt: toDateTimeLocal(event.registrationOpensAt),
    registrationClosesAt: toDateTimeLocal(event.registrationClosesAt),
    checkInOpensAt: toDateTimeLocal(event.checkInOpensAt),
    checkInClosesAt: toDateTimeLocal(event.checkInClosesAt),
    capacity: String(event.capacity),
    waitlistEnabled: event.waitlistEnabled,
    requiresClubMembership: event.requiresClubMembership,
    certificateEnabled: event.certificateEnabled,
    certificateTitle: event.certificateTitle ?? '',
    certificateSignatory: event.certificateSignatory ?? '',
  };
}

/** One value converted from its form representation to its wire representation. */
function wire(key: keyof EventFormValues, values: EventFormValues): unknown {
  if ((DATETIME_KEYS as readonly string[]).includes(key)) {
    const local = values[key] as string;
    return local ? fromDateTimeLocal(local) : undefined;
  }
  if (key === 'capacity') return Number(values.capacity);
  if ((NULLABLE_KEYS as readonly string[]).includes(key)) return (values[key] as string) || null;
  return values[key];
}

export function toCreateBody(
  eventId: string,
  values: EventFormValues,
  posterUploaded: boolean,
): CreateEventBody {
  const body: Record<string, unknown> = { eventId, posterUploaded };
  for (const key of Object.keys(EMPTY_EVENT) as (keyof EventFormValues)[]) {
    const value = wire(key, values);
    if (value !== undefined) body[key] = value;
  }
  return body as unknown as CreateEventBody;
}

/**
 * Only the keys that actually changed and that this viewer may set. Sending an
 * unchanged field the viewer's bucket excludes would be refused outright, so
 * an Operations officer saving the form must not resend the title.
 */
export function toPatchBody(
  values: EventFormValues,
  base: EventFormValues,
  can: (field: EventField) => boolean,
): PatchEventBody {
  const patch: Record<string, unknown> = {};
  for (const key of Object.keys(EMPTY_EVENT) as (keyof EventFormValues & EventField)[]) {
    if (values[key] === base[key] || !can(key)) continue;
    const value = wire(key, values);
    if (value !== undefined) patch[key] = value;
  }
  return patch as PatchEventBody;
}
