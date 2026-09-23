import { describe, expect, it } from 'vitest';
import { certificateFieldsComplete } from './certificate-fields';

const off = { certificateEnabled: false, certificateTitle: null, certificateSignatory: null };

describe('certificateFieldsComplete', () => {
  it('asks for nothing while certificates are off', () => {
    expect(certificateFieldsComplete(off)).toBe(true);
    // Still complete with a leftover title: turning the toggle off does not
    // make the stored text a problem, and refusing the save would trap an
    // officer who only wanted to switch certificates off.
    expect(certificateFieldsComplete({ ...off, certificateTitle: 'Old title' })).toBe(true);
  });

  it('needs both fields once certificates are on', () => {
    // Discriminating: a rule checking only the title accepts an enabled
    // certificate with no signatory, which renders a document signed by
    // nobody. Each half is asserted missing on its own.
    const on = { ...off, certificateEnabled: true };
    expect(certificateFieldsComplete(on)).toBe(false);
    expect(certificateFieldsComplete({ ...on, certificateTitle: 'A' })).toBe(false);
    expect(certificateFieldsComplete({ ...on, certificateSignatory: 'B' })).toBe(false);
    expect(certificateFieldsComplete({ ...on, certificateTitle: 'A', certificateSignatory: 'B' })).toBe(true);
  });

  it('does not count whitespace as a value', () => {
    // A trimmed empty string reaches the PDF as a blank line where a name
    // belongs, and `!== null` would accept it.
    const on = { certificateEnabled: true, certificateTitle: '   ', certificateSignatory: 'B' };
    expect(certificateFieldsComplete(on)).toBe(false);
  });
});
