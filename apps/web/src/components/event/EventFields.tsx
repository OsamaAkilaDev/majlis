'use client';

import { DateTimeRange } from '@/components/DateTimeRange';
import { Field } from '@/components/Field';
import { ScheduleTimeline, WINDOW_COLOUR } from '@/components/ScheduleTimeline';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import type { ProblemError } from '@/lib/api';
import { certificateFieldsComplete } from '@majlis/contracts';
import type { CreateEventBody, EventDetail, PatchEventBody } from '@majlis/contracts';
import type { EventField } from '@/lib/event-fields';
import { useViewerZone } from '@/lib/use-viewer-zone';
import {
  validateSchedule,
  windowLength,
  type Schedule,
  type ScheduleWindow,
} from '@/lib/event-schedule';

/**
 * Every writable field of an event, shared by the create panel and the editor
 * so the two cannot drift into different forms of the same object. Strings
 * throughout: an <input> holds text, and the caller converts on submit.
 *
 * The four timestamps hold absolute ISO instants, not the wall clock a
 * `datetime-local` meant, which could never say which zone it was counting in.
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
  capacity: '30',
  waitlistEnabled: true,
  requiresClubMembership: false,
  certificateEnabled: false,
  certificateTitle: '',
  certificateSignatory: '',
};

/** The runtime's own tz database, so a zone the server cannot resolve cannot be chosen. */
const ZONES = Intl.supportedValuesOf('timeZone');

const OPTIONAL = (
  <span className="text-label font-semibold tracking-[0.06em] text-ink-3 uppercase">Optional</span>
);

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
  // Undefined until mounted: the server cannot know it, and every time in the
  // product now reads on the viewer own clock.
  const viewerZone = useViewerZone();

  // Marked on the exception, not the rule: four fields on this form are
  // nullable and the rest are required, so an asterisk per required field would
  // be a mark on nearly everything, carrying what four words carry here.
  const text = (
    key: keyof EventFormValues & EventField,
    label: string,
    placeholder: string,
    required = false,
  ) => (
    <Field
      label={label}
      error={error?.fieldError(key)}
      constraint={required ? undefined : OPTIONAL}
    >
      <Input
        value={values[key] as string}
        onChange={(e) => set(key, e.target.value as EventFormValues[typeof key])}
        placeholder={placeholder}
        disabled={disabled(key)}
        required={required}
      />
    </Field>
  );

  const schedule = values as unknown as Schedule;
  const scheduleErrors = validateSchedule(schedule);

  // Blank once certificates are on would fail certificateFieldsComplete with
  // both fields empty, so this reduces to the toggle without restating it as
  // a second, hand-written condition.
  const certificateRequired = !certificateFieldsComplete({
    certificateEnabled: values.certificateEnabled,
    certificateTitle: null,
    certificateSignatory: null,
  });

  // Both ends of every window sit in the same EVENT_FIELDS bucket, so one
  // control cannot be half-writable.
  const range = (
    window: ScheduleWindow,
    label: string,
    [from, to]: [keyof EventFormValues & EventField, keyof EventFormValues & EventField],
  ) => (
    <DateTimeRange
      label={label}
      timeZone={viewerZone}
      swatch={WINDOW_COLOUR[window]}
      from={values[from] as string}
      to={values[to] as string}
      disabled={disabled(from)}
      error={scheduleErrors[window] ?? error?.fieldError(from) ?? error?.fieldError(to)}
      hint={windowLength(values[from] as string, values[to] as string)}
      onChange={(a, b) => {
        set(from, a as EventFormValues[typeof from]);
        set(to, b as EventFormValues[typeof to]);
      }}
    />
  );

  const toggle = (key: keyof EventFormValues & EventField, label: string) => (
    <Field label={label} error={error?.fieldError(key)}>
      <Switch
        checked={values[key] as boolean}
        onCheckedChange={(on) => set(key, on as EventFormValues[typeof key])}
        disabled={disabled(key)}
        className="self-start"
      />
    </Field>
  );

  return (
    <div className="flex flex-col gap-8">
      <Group legend="Details">
        {text('title', 'Title', 'Robotics Night', true)}
        {text('summary', 'Summary', 'An evening of line-follower builds, ending in a race.', true)}
        <Field label="Description" error={error?.fieldError('description')}>
          <Textarea
            value={values.description}
            onChange={(e) => set('description', e.target.value)}
            placeholder={
              'Teams of three build a line-following robot from a supplied kit, then race ' +
              'them over a timed course. Kits, tools and pizza are provided. No prior ' +
              'electronics experience needed.'
            }
            disabled={disabled('description')}
            rows={6}
            required
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          {text('eventType', 'Type', 'Workshop', true)}
          {text('audience', 'Audience', 'All students', true)}
        </div>
      </Group>

      <Group legend="Place">
        <div className="grid gap-4 sm:grid-cols-2">
          {text('venue', 'Venue', 'Building 5, Hall 2')}
          {text('onlineUrl', 'Online URL', 'https://meet.google.com/abc-defg-hij')}
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
        {/* Two windows, not four timestamps. Check-in has none of its own: an
            event can be scanned for exactly as long as it is running. */}
        {range('registration', 'Registration', ['registrationOpensAt', 'registrationClosesAt'])}
        {range('event', 'Event', ['startsAt', 'endsAt'])}
        <ScheduleTimeline schedule={schedule} timeZone={viewerZone} errors={scheduleErrors} />
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
          {text(
            'certificateTitle',
            'Certificate title',
            'Certificate of Participation',
            certificateRequired,
          )}
          {text(
            'certificateSignatory',
            'Signatory',
            'Dr Layla Haddad, Dean of Student Affairs',
            certificateRequired,
          )}
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
] as const;

/** Empty text means "no value" for the four nullable columns. */
const NULLABLE_KEYS = ['venue', 'onlineUrl', 'certificateTitle', 'certificateSignatory'] as const;

export { validateSchedule };

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
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    registrationOpensAt: event.registrationOpensAt,
    registrationClosesAt: event.registrationClosesAt,
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
  // Already an absolute instant; an empty one means the API should default it.
  if ((DATETIME_KEYS as readonly string[]).includes(key))
    return (values[key] as string) || undefined;
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
