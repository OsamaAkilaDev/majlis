import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { scheduleSpans, validateSchedule, type Schedule } from './event-schedule';

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
    expect(validateSchedule(of({ registrationClosesAt: BASE.registrationOpensAt })).registration).toBeTruthy();
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
