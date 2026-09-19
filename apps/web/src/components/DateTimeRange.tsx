'use client';

import { CalendarBlank, CaretLeft, CaretRight, WarningCircle } from '@phosphor-icons/react/ssr';
import {
  Button,
  CalendarCell,
  CalendarGrid,
  DateInput,
  DateRangePicker,
  DateSegment,
  Dialog,
  Group,
  Heading,
  I18nProvider,
  Label,
  Popover,
  RangeCalendar,
} from 'react-aria-components';
import { cn } from '@/lib/cn';
import { ICON_WEIGHT } from '@/lib/icons';
import { placeholderIn, readIn } from '@/lib/zoned';

/**
 * One window, not two timestamps. An event carries six of these columns and
 * they are three windows; the rules between them were invisible until the API
 * answered 422, and a pair of `datetime-local` inputs cannot express "these
 * two belong together" at all.
 *
 * Edited in the venue's zone, which is what `Event.timezone` means and what
 * every screen renders the event in. `datetime-local` could only ever mean the
 * editor's own zone.
 */
export function DateTimeRange({
  label,
  timeZone,
  from,
  to,
  onChange,
  swatch,
  error,
  disabled,
  hint,
}: {
  label: string;
  timeZone: string;
  /** ISO instants, or empty while unset. */
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
  /** The colour this window wears on the timeline. */
  swatch: string;
  error?: string | undefined;
  disabled?: boolean;
  /** A fact about the window, such as how long it runs. Never an instruction. */
  hint?: string;
}) {
  const start = readIn(from, timeZone);
  const end = readIn(to, timeZone);

  return (
    // Segment order comes from the locale, and the runtime's default put the
    // month first while `formatMoment` and the timeline both render day first.
    // On the one screen where a date is typed rather than read, 09/10 meaning
    // two different days depending on which control you are looking at is a
    // trap rather than a preference.
    <I18nProvider locale="en-GB">
      <DateRangePicker
        aria-label={label}
        value={start && end ? { start, end } : null}
        // Not decoration. React Aria takes the type of every value this picker
        // emits from whichever of `value` or `placeholderValue` it was given, and
        // an empty control has no value to take it from: without this it emits a
        // zoneless CalendarDateTime and the first range picked throws on
        // `toAbsoluteString`. See lib/zoned.ts.
        placeholderValue={placeholderIn(timeZone)}
        // Null when a segment is blanked out. Clearing both ends is what the
        // officer just asked for; leaving the old instants in form state would
        // save a window they can no longer see.
        onChange={(next) =>
          onChange(next?.start.toAbsoluteString() ?? '', next?.end.toAbsoluteString() ?? '')
        }
        granularity="minute"
        hourCycle={24}
        isDisabled={disabled}
        isInvalid={Boolean(error)}
        shouldForceLeadingZeros
        className="flex flex-col gap-1.5"
      >
        <Label className="flex items-center gap-2 text-label font-bold tracking-[0.07em] text-ink-3 uppercase">
          <span aria-hidden className="size-2.5 rounded-[3px]" style={{ background: swatch }} />
          {label}
        </Label>

        <Group className="flex min-h-10 items-center gap-2 rounded-control border border-border-control bg-surface px-2.5 py-1.5 focus-within:border-primary focus-within:ring-3 focus-within:ring-primary-soft data-[invalid]:border-bad data-[invalid]:focus-within:ring-bad-soft data-disabled:opacity-50">
          <DateInput slot="start" className="flex items-center text-sm tabular-nums text-ink">
            {(segment) => <Segment segment={segment} />}
          </DateInput>

          <span aria-hidden className="shrink-0 text-ink-3">
            →
          </span>

          <DateInput slot="end" className="flex items-center text-sm tabular-nums text-ink">
            {(segment) => <Segment segment={segment} />}
          </DateInput>

          <Button
            className="ml-auto grid size-7 shrink-0 place-items-center rounded-control text-ink-2 hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
            aria-label={`${label}: pick dates`}
          >
            <CalendarBlank size={16} weight={ICON_WEIGHT} aria-hidden />
          </Button>
        </Group>

        {error ? (
          <p role="alert" className="flex items-start gap-1.5 text-sm font-medium text-bad-fg">
            <WarningCircle size={14} weight={ICON_WEIGHT} className="mt-0.5 shrink-0" aria-hidden />
            {error}
          </p>
        ) : hint ? (
          <p className="text-sm text-ink-2">{hint}</p>
        ) : null}

        <Popover className="rounded-card border border-border bg-surface p-3 shadow-[var(--shadow-md)]">
          <Dialog className="outline-none">
            <RangeCalendar className="flex flex-col gap-2">
              <header className="flex items-center gap-2">
                <Button
                  slot="previous"
                  aria-label="Previous month"
                  className="grid size-7 place-items-center rounded-control text-ink-2 hover:bg-surface-2"
                >
                  <CaretLeft size={15} weight={ICON_WEIGHT} aria-hidden />
                </Button>
                <Heading className="flex-1 text-center text-sm font-semibold text-ink" />
                <Button
                  slot="next"
                  aria-label="Next month"
                  className="grid size-7 place-items-center rounded-control text-ink-2 hover:bg-surface-2"
                >
                  <CaretRight size={15} weight={ICON_WEIGHT} aria-hidden />
                </Button>
              </header>

              <CalendarGrid className="border-separate border-spacing-0.5">
                {(date) => (
                  <CalendarCell
                    date={date}
                    className={cn(
                      'grid size-8 cursor-default place-items-center rounded-control text-sm tabular-nums text-ink outline-none',
                      'data-outside-month:invisible data-disabled:text-ink-3',
                      'data-hovered:bg-surface-2',
                      'data-selected:bg-primary-soft data-selected:text-primary-soft-fg',
                      'data-selection-start:bg-primary data-selection-start:text-primary-fg',
                      'data-selection-end:bg-primary data-selection-end:text-primary-fg',
                      'data-focus-visible:outline-2 data-focus-visible:outline-offset-1 data-focus-visible:outline-focus',
                    )}
                  />
                )}
              </CalendarGrid>
            </RangeCalendar>
          </Dialog>
        </Popover>
      </DateRangePicker>
    </I18nProvider>
  );
}

/** The segment being edited is the one the caret is on, so it says so. */
function Segment({
  segment,
}: {
  segment: Parameters<Parameters<typeof DateInput>[0]['children']>[0];
}) {
  return (
    <DateSegment
      segment={segment}
      className={cn(
        'rounded-[4px] px-0.5 tabular-nums outline-none',
        'data-placeholder:text-ink-3',
        'data-focused:bg-primary data-focused:text-primary-fg',
        segment.type === 'literal' && 'px-0 text-ink-3',
      )}
    />
  );
}
