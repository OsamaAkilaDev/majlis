/**
 * Bar lengths as percentages of the largest bar, so the mark reflows with its
 * container rather than being drawn into a fixed viewBox that would scale the
 * labels down with it.
 *
 * Normalised on the maximum, not on the total: these are counts by category,
 * and a share-of-total reading would be a different chart. An all-zero series
 * returns all zeros rather than NaN, which SVG renders as nothing at all.
 */
export function barPercents(values: number[]): number[] {
  const max = Math.max(0, ...values);
  return values.map((v) => (max > 0 ? (Math.max(v, 0) / max) * 100 : 0));
}

/**
 * A status tally as ordered bars. The API's `groupBy` returns only the
 * statuses that actually occur, so the canonical order has to be supplied
 * here rather than read off the object's keys, whose order is the database's.
 *
 * A status missing from `order` is kept, at the end: a value added to the
 * enum must show up in the report rather than vanish from a chart that
 * silently filtered it out.
 */
export function statusBars(
  counts: Record<string, number>,
  order: readonly string[],
  label: (status: string) => string,
): Array<{ label: string; value: number }> {
  const keys = Object.keys(counts);
  const known = order.filter((s) => s in counts);
  const rest = keys.filter((s) => !order.includes(s)).sort();
  return [...known, ...rest].map((s) => ({ label: label(s), value: counts[s] ?? 0 }));
}
