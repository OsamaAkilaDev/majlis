/**
 * "VICE_LEAD" -> "Vice Lead". Every screen that renders a database enum
 * value goes through this, so club roles and event responsibilities cannot
 * end up cased differently from each other.
 */
export function enumLabel(value: string): string {
  return value
    .split('_')
    .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
    .join(' ');
}
