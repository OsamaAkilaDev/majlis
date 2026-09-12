import { describe, expect, it } from 'vitest';
import { eventTimes, formatRange } from './event-time';

// 2026-09-12T14:00Z is 18:00 in Dubai (+04) and 15:00 in London (BST, +01).
const STARTS = '2026-09-12T14:00:00.000Z';
const ENDS = '2026-09-12T17:00:00.000Z';

describe('formatRange', () => {
  it('renders the wall clock of the zone it is given, not the runtime default', () => {
    expect(formatRange(STARTS, ENDS, 'Asia/Dubai')).toContain('18:00 to 21:00');
    expect(formatRange(STARTS, ENDS, 'Europe/London')).toContain('15:00 to 18:00');
  });

  it('carries the second date only when the event crosses midnight in that zone', () => {
    // 21:00 to 00:30 Dubai: one calendar day in London, two in Dubai.
    const late = { start: '2026-09-12T17:00:00.000Z', end: '2026-09-12T20:30:00.000Z' };
    expect(formatRange(late.start, late.end, 'Asia/Dubai')).toMatch(
      /Sat 12 Sept, 21:00 to Sun 13 Sept, 00:30/,
    );
    expect(formatRange(late.start, late.end, 'Europe/London')).toMatch(/^Sat 12 Sept, 18:00 to 21:30/);
  });
});

describe('eventTimes', () => {
  it('gives the venue zone first and the viewer zone second', () => {
    const times = eventTimes(STARTS, ENDS, 'Asia/Dubai', 'Europe/London');
    expect(times.venue).toContain('18:00 to 21:00');
    expect(times.viewer).toContain('15:00 to 18:00');
  });

  it('omits the viewer line when it would repeat the venue line', () => {
    expect(eventTimes(STARTS, ENDS, 'Asia/Dubai', 'Asia/Dubai').viewer).toBeNull();
    // Same offset, same abbreviation, different IANA name: still one line.
    expect(eventTimes(STARTS, ENDS, 'Asia/Dubai', 'Asia/Muscat').viewer).toBeNull();
  });
});
