/**
 * Scalars the web app needs in a client component, and nothing else.
 *
 * This module imports nothing, deliberately. It is exported on its own
 * subpath (`@majlis/contracts/constants`) so a client component can read one
 * of these without importing the barrel, which re-exports all fifteen schema
 * modules and so drags Zod and every schema into the client bundle. The
 * barrel still re-exports them, so a server-side import keeps working.
 */

/** The signup form states the rule from the schema that enforces it. */
export const PASSWORD_MIN = 12;

/**
 * Spec 8 forbids an unbounded list anywhere, and an export is inherently a
 * bulk read. Both halves need these: the API writes the trailer row, and the
 * screen that triggered the download reads it back to report the cap. Two
 * copies of the sentence would drift the moment either side reworded it.
 */
export const EXPORT_ROW_CAP = 10_000;

export const EXPORT_CAP_NOTICE = `Truncated at ${EXPORT_ROW_CAP} rows. Narrow the export and try again.`;

/** True when an export ended in the cap trailer rather than a data row. */
export function isCapped(csv: string): boolean {
  return csv.trimEnd().endsWith(EXPORT_CAP_NOTICE);
}
