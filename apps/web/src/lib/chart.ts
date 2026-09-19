/**
 * Percentages of the largest bar, not of the total: these are counts by
 * category, and a share-of-total reading is a different chart. An all-zero
 * series returns zeros rather than NaN, which SVG renders as nothing.
 */
export function barPercents(values: number[]): number[] {
  const max = Math.max(0, ...values);
  return values.map((v) => (max > 0 ? (Math.max(v, 0) / max) * 100 : 0));
}

/**
 * `groupBy` returns only the statuses that occur, so the canonical order is
 * supplied rather than read off the object's keys. A status missing from
 * `order` is kept at the end: a new enum value must show up in the report
 * rather than vanish from a chart that filtered it out.
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
