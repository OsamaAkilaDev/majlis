import { describe, expect, it } from 'vitest';
import { STATUS_LABEL, STATUS_TONE } from './StatusBadge';

describe('status vocabulary', () => {
  it('gives every status a tone and a word', () => {
    // Catches a status added to one map and not the other, which renders as an
    // unstyled or unlabelled badge for exactly one enum value in production.
    expect(Object.keys(STATUS_TONE).sort()).toEqual(Object.keys(STATUS_LABEL).sort());
  });

  it('never leaves a label empty', () => {
    // Colour alone must never carry meaning (spec 9.5). An empty label renders
    // a bare coloured pill, which passes a "renders without crashing" test.
    for (const [key, label] of Object.entries(STATUS_LABEL)) {
      expect(label.trim(), `${key} has no word`).not.toBe('');
    }
  });

  it('distinguishes cancelled from confirmed by tone', () => {
    // Catches a copy-paste that maps every status to the same tone, which
    // still satisfies the completeness test above.
    expect(STATUS_TONE.CANCELLED).not.toBe(STATUS_TONE.CONFIRMED);
  });
});
