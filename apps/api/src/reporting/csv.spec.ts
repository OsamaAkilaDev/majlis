import { describe, expect, it } from 'vitest';
import { CAP_NOTICE, EXPORT_ROW_CAP, csvCell, exportCsv } from './csv';

describe('csvCell', () => {
  it('quotes a field containing a comma', () => {
    expect(csvCell('Hall A, Building 3')).toBe('"Hall A, Building 3"');
  });

  it('doubles an embedded quote and wraps the field', () => {
    expect(csvCell('a "quoted" thing')).toBe('"a ""quoted"" thing"');
  });

  it('quotes a field containing a newline', () => {
    expect(csvCell('line one\nline two')).toBe('"line one\nline two"');
  });

  it('leaves an ordinary field alone', () => {
    expect(csvCell('Robotics Club')).toBe('Robotics Club');
  });

  it('renders null and undefined as empty, not as the words', () => {
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
  });

  for (const lead of ['=', '+', '-', '@', '\t', '\r']) {
    it(`prefixes a field starting with ${JSON.stringify(lead)} so a spreadsheet cannot evaluate it`, () => {
      // Excel, Sheets and LibreOffice all execute a cell whose text starts
      // with one of these. An event titled =cmd|'/c calc'!A1 is a command
      // somebody runs by double-clicking the exported file.
      const out = csvCell(`${lead}cmd|'/c calc'!A1`);
      expect(out.startsWith("'") || out.startsWith('"\'')).toBe(true);
      expect(out).toContain(`'${lead}`);
    });
  }

  it('keeps the formula prefix INSIDE the quotes when the field also needs quoting', () => {
    // The order of the two escapes is the whole test: prefixing after
    // quoting would produce '"..." which no parser reads as one field, and
    // the apostrophe would not be part of the cell text at all.
    expect(csvCell('=SUM(A1,A2)')).toBe('"\'=SUM(A1,A2)"');
  });
});

describe('exportCsv', () => {
  it('writes a header row and CRLF line endings', () => {
    expect(exportCsv(['a', 'b'], [[1, 2]])).toBe('a,b\r\n1,2\r\n');
  });

  it('appends a trailer row when the cap is hit, rather than truncating silently', () => {
    const rows = Array.from({ length: EXPORT_ROW_CAP + 1 }, (_, i) => [i]);
    const out = exportCsv(['n'], rows);

    expect(out.trimEnd().split('\r\n')).toHaveLength(EXPORT_ROW_CAP + 2);
    expect(out.trimEnd().endsWith(CAP_NOTICE)).toBe(true);
  });

  it('appends no trailer when the row count is exactly the cap', () => {
    const rows = Array.from({ length: EXPORT_ROW_CAP }, (_, i) => [i]);
    expect(exportCsv(['n'], rows)).not.toContain(CAP_NOTICE);
  });
});
