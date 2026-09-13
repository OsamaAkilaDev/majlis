/**
 * Spec 8 forbids an unbounded list anywhere, and an export is inherently a
 * bulk read. Every export stops here and says so in a trailer row rather
 * than silently handing back a truncated file.
 */
export const EXPORT_ROW_CAP = 10_000;

export const CAP_NOTICE = `Truncated at ${EXPORT_ROW_CAP} rows. Narrow the export and try again.`;

/**
 * One CSV field.
 *
 * Two separate escapes, and the order matters. The formula prefix goes on
 * FIRST, because a value that needs quoting too must carry the apostrophe
 * inside the quotes: Excel, Sheets and LibreOffice all evaluate a cell whose
 * text begins with `=`, `+`, `-`, `@`, a tab or a carriage return, so a
 * club named `=cmd|'/c calc'!A1` in an exported file is a command somebody
 * runs by double-clicking it. This is the escape that gets forgotten.
 *
 * Then RFC 4180 quoting, for a field carrying a comma, a quote or a newline.
 */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let text = value instanceof Date ? value.toISOString() : String(value);

  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  if (/["\r\n,]/.test(text)) text = `"${text.replace(/"/g, '""')}"`;

  return text;
}

/**
 * A complete CSV document. `rows` must have been fetched with
 * `take: EXPORT_ROW_CAP + 1`, which is how the cap is detected without a
 * second COUNT.
 *
 * CRLF line endings, per RFC 4180, and a trailing one so the last row is
 * terminated like every other.
 */
export function exportCsv(headers: string[], rows: unknown[][]): string {
  const capped = rows.length > EXPORT_ROW_CAP;
  const body = capped ? rows.slice(0, EXPORT_ROW_CAP) : rows;

  const lines = [headers, ...body].map((row) => row.map(csvCell).join(','));
  if (capped) lines.push(csvCell(CAP_NOTICE));

  return `${lines.join('\r\n')}\r\n`;
}

/** The Content-Disposition an export answers with. */
export function attachment(filename: string): string {
  return `attachment; filename="${filename}"`;
}
