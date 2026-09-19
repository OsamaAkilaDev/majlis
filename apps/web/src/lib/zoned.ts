import { now, parseAbsolute, type ZonedDateTime } from '@internationalized/date';

/**
 * The zone-carrying values React Aria's date pickers are driven with.
 *
 * Every timestamp on an event is an absolute instant, edited on the reader's
 * own clock. React Aria decides the type of every value a
 * picker emits from whichever of `value` or `placeholderValue` it was given,
 * and it infers nothing from a null value: an empty control with no placeholder
 * yields a `CalendarDateTime`, a wall clock with no zone and no
 * `toAbsoluteString`. So a picker over these columns needs a placeholder even
 * though there is nothing to place: it is what declares the type.
 */

/** An absolute instant read in a given zone, or null when unset or unparseable. */
export function readIn(iso: string, timeZone: string): ZonedDateTime | null {
  if (!iso) return null;
  try {
    return parseAbsolute(iso, timeZone);
  } catch {
    return null;
  }
}

/**
 * Midnight today in `timeZone`, which is what an empty picker fills its
 * segments from and, more importantly, the type it emits.
 */
export function placeholderIn(timeZone: string): ZonedDateTime {
  // `Event.timezone` is chosen from Intl.supportedValuesOf and validated
  // server-side, so an unresolvable zone should not reach this. A throw would
  // take the whole form down rather than one control, so it does not.
  try {
    return now(timeZone).set({ hour: 0, minute: 0, second: 0, millisecond: 0 });
  } catch {
    return now('UTC').set({ hour: 0, minute: 0, second: 0, millisecond: 0 });
  }
}
