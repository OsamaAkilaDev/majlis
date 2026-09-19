/**
 * The same four rules `assertWindows` applies in
 * `apps/api/src/events/events.service.ts`, which are themselves the CHECK
 * constraints in the events migration.
 *
 * Deliberately no rule the API does not enforce. A form that refuses what the
 * server accepts is a control the officer cannot get past and nobody can
 * explain; the odd-but-legal window shows on the timeline instead.
 */

export const SCHEDULE_KEYS = [
  'startsAt',
  'endsAt',
  'registrationOpensAt',
  'registrationClosesAt',
  'checkInOpensAt',
  'checkInClosesAt',
] as const;

export type ScheduleKey = (typeof SCHEDULE_KEYS)[number];
export type ScheduleWindow = 'event' | 'registration' | 'checkIn';

export type Schedule = Record<ScheduleKey, string>;

export const WINDOW_ENDS: Record<ScheduleWindow, [ScheduleKey, ScheduleKey]> = {
  event: ['startsAt', 'endsAt'],
  registration: ['registrationOpensAt', 'registrationClosesAt'],
  checkIn: ['checkInOpensAt', 'checkInClosesAt'],
};

/** Milliseconds, or null when the value is absent or not a date. */
function at(iso: string): number | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime();
  return Number.isNaN(ms) ? null : ms;
}

/**
 * One message per window, or nothing. A window with an end missing is not
 * wrong yet: the control is required, and refusing it before it is filled
 * reports an error the officer is in the middle of not making.
 */
export function validateSchedule(schedule: Schedule): Partial<Record<ScheduleWindow, string>> {
  const errors: Partial<Record<ScheduleWindow, string>> = {};

  const starts = at(schedule.startsAt);
  const ends = at(schedule.endsAt);
  const opens = at(schedule.registrationOpensAt);
  const closes = at(schedule.registrationClosesAt);
  const checkOpens = at(schedule.checkInOpensAt);
  const checkCloses = at(schedule.checkInClosesAt);

  if (starts !== null && ends !== null && starts >= ends) {
    errors.event = 'An event must end after it starts.';
  }

  if (opens !== null && closes !== null && opens >= closes) {
    errors.registration = 'Registration must close after it opens.';
  } else if (closes !== null && ends !== null && closes > ends) {
    errors.registration = 'Registration cannot close after the event ends.';
  }

  if (checkOpens !== null && checkCloses !== null && checkOpens >= checkCloses) {
    errors.checkIn = 'Check-in must close after it opens.';
  }

  return errors;
}

/** How long a window runs, as a fact rather than a sentence about it. Empty
 *  while either end is unset. */
export function windowLength(from: string, to: string): string {
  const a = at(from);
  const b = at(to);
  if (a === null || b === null || b < a) return '';

  const minutes = Math.round((b - a) / 60_000);
  if (minutes < 60) return `${minutes} min`;

  const hours = minutes / 60;
  if (hours < 48) {
    const whole = Math.floor(hours);
    const rest = minutes - whole * 60;
    return rest === 0 ? `${whole} h` : `${whole} h ${rest} min`;
  }

  return `${Math.round(hours / 24)} days`;
}

export interface Span {
  window: ScheduleWindow;
  /** Fractions of the whole schedule, 0 to 1. */
  offset: number;
  length: number;
}

/**
 * The three windows placed on one axis, for a strip that shows how they sit
 * against each other. Null when nothing is filled in yet, or when every
 * timestamp is the same instant and there is no axis to draw.
 */
export function scheduleSpans(schedule: Schedule): { spans: Span[]; from: number; to: number } | null {
  const windows = (Object.keys(WINDOW_ENDS) as ScheduleWindow[])
    .map((window) => {
      const [a, b] = WINDOW_ENDS[window];
      const from = at(schedule[a]);
      const to = at(schedule[b]);
      return from !== null && to !== null ? { window, from, to: Math.max(to, from) } : null;
    })
    .filter((w) => w !== null);

  if (windows.length === 0) return null;

  const from = Math.min(...windows.map((w) => w.from));
  const to = Math.max(...windows.map((w) => w.to));
  const total = to - from;
  if (total <= 0) return null;

  return {
    from,
    to,
    spans: windows.map((w) => ({
      window: w.window,
      offset: (w.from - from) / total,
      // A window shorter than a hair of the axis still has to be findable.
      length: Math.max((w.to - w.from) / total, 0.01),
    })),
  };
}
