'use client';

import { toCalendarDate } from '@internationalized/date';
import { CalendarBlank, CaretLeft, CaretRight, WarningCircle } from '@phosphor-icons/react/ssr';
import { useContext, useEffect } from 'react';
import {
  Button,
  CalendarCell,
  CalendarGrid,
  DateInput,
  DateRangePicker,
  DateRangePickerStateContext,
  DateSegment,
  Dialog,
  Group,
  Heading,
  I18nProvider,
  Label,
  Popover,
  RangeCalendar,
  TimeField,
} from 'react-aria-components';
import { cn } from '@/lib/cn';
import { ICON_WEIGHT } from '@/lib/icons';
import { placeholderIn, readIn } from '@/lib/zoned';

/**
 * One window, not two timestamps. An event carries four of these columns and
 * they are two windows; the rules between them were invisible until the API
 * answered 422, and a pair of `datetime-local` inputs cannot express "these
 * two belong together" at all.
 *
 * Edited on the viewer's own clock and stored as an absolute instant (revised
 * 2026-09-19; it used to be edited in the venue's zone). `timeZone` is
 * therefore the reader's, and is undefined until mounted, because the server's
 * zone is not it: see `lib/use-viewer-zone.ts`.
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
  /** The viewer's zone, undefined until mounted. */
  timeZone: string | undefined;
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
  // Nothing renders until the zone is known, and not only because the stored
  // instants would otherwise be read in the server's. The segments themselves
  // are built by Intl, and Node's ICU and the browser's disagree about the bidi
  // isolates around a 12-hour clock: rendering them on the server is a
  // hydration mismatch, which React answers by throwing the tree away. The
  // editor is server-rendered with its event, so this is the path that hits it.
  // A box of the control's own height holds the space so the form does not jump.
  if (timeZone === undefined) {
    return (
      <div className="flex flex-col gap-1.5">
        <span className="flex items-center gap-2 text-label font-bold tracking-[0.07em] text-ink-3 uppercase">
          <span aria-hidden className="size-2.5 rounded-[3px]" style={{ background: swatch }} />
          {label}
        </span>
        <div className="min-h-10 rounded-control border border-border-control bg-surface" />
      </div>
    );
  }

  const zone = timeZone;
  const start = readIn(from, zone);
  const end = readIn(to, zone);

  return (
    // Segment order comes from the locale, and the runtime's default put the
    // month first while every rendered date in the product is day first. On the
    // one control where a date is typed rather than read, 09/10 meaning two
    // different days depending on where you look is a trap, not a preference.
    // `en-GB` writes a lowercase day period, which `Segment` uppercases.
    <I18nProvider locale="en-GB">
      <DateRangePicker
        aria-label={label}
        value={start && end ? { start, end } : null}
        // Not decoration. React Aria takes the type of every value this picker
        // emits from whichever of `value` or `placeholderValue` it was given,
        // and an empty control has no value to take it from: without this it
        // emits a zoneless CalendarDateTime and the first range picked throws
        // on `toAbsoluteString`. See lib/zoned.ts.
        placeholderValue={placeholderIn(zone)}
        // Null when a segment is blanked out. Clearing both ends is what the
        // officer just asked for; leaving the old instants in form state would
        // save a window they can no longer see.
        onChange={(next) =>
          onChange(next?.start.toAbsoluteString() ?? '', next?.end.toAbsoluteString() ?? '')
        }
        granularity="minute"
        hourCycle={12}
        // A zoned value plus a time granularity makes React Aria append a
        // timeZoneName segment of its own accord ("GST"). Nothing in the
        // product names a zone: the reader is already in it.
        hideTimeZone
        // The default shuts the popover the instant the second date lands,
        // which would close over the clocks below the grid. `SeedTimes` is what
        // makes that safe.
        shouldCloseOnSelect={false}
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
          <Dialog className="flex flex-col gap-3 outline-none">
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

            <SeedTimes timeZone={zone} />

            <div className="grid grid-cols-2 gap-2 border-t border-border pt-3">
              <Clock part="start" label="Starts" timeZone={zone} />
              <Clock part="end" label="Ends" timeZone={zone} />
            </div>
          </Dialog>
        </Popover>
      </DateRangePicker>
    </I18nProvider>
  );
}

/**
 * Commits a freshly picked date range at midnight, the moment both ends exist.
 *
 * `shouldCloseOnSelect={false}` is what keeps the popover open long enough to
 * reach the clocks, and it also switches the picker to holding the range as a
 * draft that commits only once BOTH times are set. An officer who picks two
 * dates and closes the popover would otherwise lose them with no message. This
 * commits on their behalf, so closing early keeps the dates and the clocks then
 * edit a value that already exists.
 *
 * One `setValue`, not two `setTime`s: `setTime` closes over the time range it
 * was rendered with, so a second call in the same tick overwrites the first.
 */
function SeedTimes({ timeZone }: { timeZone: string }) {
  const state = useContext(DateRangePickerStateContext);

  useEffect(() => {
    const range = state?.dateRange;
    if (!state || !range?.start || !range.end) return;
    // Already carries a time, either from this seeding or from a stored value.
    if (state.timeRange?.start && state.timeRange.end) return;

    const midnight = placeholderIn(timeZone);
    state.setValue({
      start: midnight.set(toCalendarDate(range.start)),
      end: midnight.set(toCalendarDate(range.end)),
    });
  });

  return null;
}

/** One end's clock, inside the popover, beneath the grid that sets its date. */
function Clock({
  part,
  label,
  timeZone,
}: {
  part: 'start' | 'end';
  label: string;
  timeZone: string;
}) {
  const state = useContext(DateRangePickerStateContext);
  const value = state?.timeRange?.[part] ?? null;

  return (
    <TimeField
      value={value}
      onChange={(next) => next && state?.setTime(part, next)}
      // Nothing to hang a time on until the grid has a date for this end, and
      // a time set now would be dropped rather than remembered.
      isDisabled={!value}
      placeholderValue={placeholderIn(timeZone)}
      granularity="minute"
      hourCycle={12}
      hideTimeZone
      shouldForceLeadingZeros
      className="flex flex-col gap-1"
    >
      <Label className="text-label font-bold tracking-[0.07em] text-ink-3 uppercase">{label}</Label>
      <DateInput className="flex min-h-9 items-center rounded-control border border-border-control bg-surface px-2 text-sm tabular-nums text-ink focus-within:border-primary focus-within:ring-3 focus-within:ring-primary-soft data-disabled:opacity-50">
        {(segment) => <Segment segment={segment} />}
      </DateInput>
    </TimeField>
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
        // en-GB writes "pm"; the product writes "PM".
        segment.type === 'dayPeriod' && 'uppercase',
      )}
    />
  );
}
