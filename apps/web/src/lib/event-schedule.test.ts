import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { scheduleSpans, splitOnEnd, validateSchedule, type Schedule } from './event-schedule';

const SOURCE = '../api/src/events/events.service.ts';

const BASE: Schedule = {
  startsAt: '2026-09-24T14:00:00.000Z',
  endsAt: '2026-09-24T17:00:00.000Z',
  registrationOpensAt: '2026-09-10T05:00:00.000Z',
  registrationClosesAt: '2026-09-23T19:59:00.000Z',
};

const of = (overrides: Partial<Schedule>): Schedule => ({ ...BASE, ...overrides });

describe('validateSchedule', () => {
  it('passes a schedule the API accepts', () => {
    expect(validateSchedule(BASE)).toEqual({});
  });

  it('refuses an event that ends when or before it starts', () => {
    expect(validateSchedule(of({ endsAt: BASE.startsAt })).event).toBeTruthy();
    expect(validateSchedule(of({ endsAt: '2026-09-24T13:00:00.000Z' })).event).toBeTruthy();
  });

  it('refuses registration that closes when or before it opens', () => {
    expect(
      validateSchedule(of({ registrationClosesAt: BASE.registrationOpensAt })).registration,
    ).toBeTruthy();
  });

  it('refuses registration that closes after the event ends', () => {
    // The rule that catches nobody until submit today, and the one an officer
    // is most likely to trip by moving the event earlier.
    const errors = validateSchedule(of({ registrationClosesAt: '2026-09-24T18:00:00.000Z' }));
    expect(errors.registration).toContain('after the event ends');
  });

  it('allows registration closing exactly when the event ends', () => {
    // `>` in the API, not `>=`: an off-by-one here would refuse a schedule the
    // server takes.
    expect(validateSchedule(of({ registrationClosesAt: BASE.endsAt }))).toEqual({});
  });

  it('allows registration that opens after the event has started', () => {
    // Odd, and the API takes it: the only rules are that registration closes
    // after it opens and no later than the event ends. A form refusing what the
    // server accepts is a control nobody can get past.
    expect(
      validateSchedule(
        of({
          registrationOpensAt: '2026-09-24T15:00:00.000Z',
          registrationClosesAt: '2026-09-24T16:00:00.000Z',
        }),
      ),
    ).toEqual({});
  });

  it('says nothing about a window with an end still empty', () => {
    expect(validateSchedule(of({ endsAt: '' }))).toEqual({});
  });

  it('carries every rule the API enforces', () => {
    // The mirror is only useful if a rule added to assertWindows shows up as a
    // failure here rather than as a 422 nobody saw coming.
    const source = readFileSync(SOURCE, 'utf8');
    const body = /function assertWindows\(w: Windows\): void \{([\s\S]*?)\n\}/.exec(source)?.[1];
    if (!body) throw new Error(`assertWindows is not in ${SOURCE}`);
    expect(body.match(/if \(/g)?.length).toBe(3);
  });
});

describe('scheduleSpans', () => {
  it('places every window on one axis, in order', () => {
    const laid = scheduleSpans(BASE);
    expect(laid).not.toBeNull();
    const spans = Object.fromEntries(laid!.spans.map((s) => [s.window, s]));
    // Registration opens first, so it starts the axis; the event ends last.
    expect(spans.registration!.offset).toBe(0);
    expect(spans.event!.offset).toBeGreaterThan(spans.registration!.offset);
    expect(spans.event!.offset + spans.event!.length).toBeLessThanOrEqual(1);
  });

  it('gives a zero-length window something to see', () => {
    const laid = scheduleSpans(of({ endsAt: BASE.startsAt }));
    expect(laid!.spans.find((s) => s.window === 'event')!.length).toBeGreaterThan(0);
  });

  it('draws nothing when no window is complete', () => {
    expect(
      scheduleSpans({
        startsAt: '',
        endsAt: '',
        registrationOpensAt: '',
        registrationClosesAt: '',
      }),
    ).toBeNull();
  });
});

describe('splitOnEnd', () => {
  const event = (id: string, startsAt: string, endsAt: string) => ({ id, startsAt, endsAt });
  const NOW = Date.parse('2026-09-12T12:00:00.000Z');

  it('keeps an event that has started but not finished out of the past', () => {
    // The API cuts `?past=` on the end, and a row that vanished from Upcoming
    // the moment its doors opened is an attendee who cannot find it.
    const running = event('running', '2026-09-12T11:00:00.000Z', '2026-09-12T13:00:00.000Z');
    const { upcoming, past } = splitOnEnd([running], NOW);
    expect(upcoming.map((e) => e.id)).toEqual(['running']);
    expect(past).toEqual([]);
  });

  it('reads each half in its own direction, whatever order it arrives in', () => {
    // The order the API sends is by id, so the input here is deliberately
    // neither: a pass-through implementation fails both assertions.
    const rows = [
      event('soon', '2026-09-13T09:00:00.000Z', '2026-09-13T10:00:00.000Z'),
      event('old', '2026-08-01T09:00:00.000Z', '2026-08-01T10:00:00.000Z'),
      event('later', '2026-10-01T09:00:00.000Z', '2026-10-01T10:00:00.000Z'),
      event('recent', '2026-09-10T09:00:00.000Z', '2026-09-10T10:00:00.000Z'),
    ];
    const { upcoming, past } = splitOnEnd(rows, NOW);
    expect(upcoming.map((e) => e.id)).toEqual(['soon', 'later']);
    expect(past.map((e) => e.id)).toEqual(['recent', 'old']);
  });

  it('leaves the page it was handed alone', () => {
    // It sorts what React is still rendering from, so a sort in place is a
    // mutation of state under the tree that read it.
    const rows = [
      event('b', '2026-10-01T09:00:00.000Z', '2026-10-01T10:00:00.000Z'),
      event('a', '2026-09-13T09:00:00.000Z', '2026-09-13T10:00:00.000Z'),
    ];
    splitOnEnd(rows, NOW);
    expect(rows.map((e) => e.id)).toEqual(['b', 'a']);
  });
});
