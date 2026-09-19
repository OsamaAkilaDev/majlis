/** "VICE_LEAD" -> "Vice Lead". Every enum rendering goes through this, so two
 *  screens cannot case the same role differently. */
export function enumLabel(value: string): string {
  return value
    .split('_')
    .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
    .join(' ');
}
