import { cn } from '@/lib/cn';
import { scheduleSpans, type Schedule, type ScheduleWindow } from '@/lib/event-schedule';

export const WINDOW_COLOUR: Record<ScheduleWindow, string> = {
  registration: 'var(--s2)',
  event: 'var(--primary)',
};

const WINDOW_LABEL: Record<ScheduleWindow, string> = {
  registration: 'Registration',
  event: 'Event',
};

function edge(ms: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone,
  }).format(new Date(ms));
}

/**
 * The two windows against each other on one axis. Every rule the API enforces
 * is about how they sit, and four separate inputs showed none of it: the strip
 * is where a registration window that runs to the last minute of the event, or
 * one that closed before it opened, becomes something you can see.
 */
export function ScheduleTimeline({
  schedule,
  timeZone,
  errors,
}: {
  schedule: Schedule;
  timeZone: string;
  errors: Partial<Record<ScheduleWindow, string>>;
}) {
  const laid = scheduleSpans(schedule);
  if (!laid) return null;

  return (
    <div className="flex flex-col gap-2 rounded-card border border-border bg-surface p-4">
      <div className="flex justify-between text-label font-semibold tracking-[0.06em] text-ink-3 uppercase">
        <span className="tabular-nums">{edge(laid.from, timeZone)}</span>
        <span className="tabular-nums">
          {edge(laid.to, timeZone)} · {timeZone}
        </span>
      </div>

      <ul className="flex flex-col gap-1.5">
        {laid.spans.map(({ window, offset, length }) => {
          const broken = Boolean(errors[window]);
          return (
            <li key={window} className="relative h-6">
              <span aria-hidden className="absolute inset-y-2 inset-x-0 rounded-full bg-surface-2" />
              <span
                className={cn(
                  'absolute top-1 flex h-4 items-center overflow-hidden rounded-full px-2 text-[0.625rem] font-bold whitespace-nowrap text-white',
                )}
                style={{
                  left: `${offset * 100}%`,
                  width: `${length * 100}%`,
                  background: broken ? 'var(--bad)' : WINDOW_COLOUR[window],
                }}
              >
                {WINDOW_LABEL[window]}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
