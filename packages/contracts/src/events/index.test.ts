import { describe, expect, it } from 'vitest';
import { createEventBodySchema, eventListQuerySchema, myRegistrationListQuerySchema, registerBodySchema } from './index';

describe('registerBodySchema', () => {
  it('accepts the empty body a student sends', () => {
    expect(registerBodySchema.parse({}).userId).toBeUndefined();
  });

  it('refuses an Admin override with no reason', () => {
    // Spec 7.4: every override records a reason. Without the refine, the
    // override would write a null reason into the audit row and be
    // indistinguishable from a bug.
    const res = registerBodySchema.safeParse({ userId: '018f8f5b-0000-7000-8000-000000000001' });
    expect(res.success).toBe(false);
    expect(res.error?.issues[0]?.path).toEqual(['overrideReason']);
  });
});

describe('createEventBodySchema', () => {
  it('defaults the flags a create body may omit', () => {
    const parsed = createEventBodySchema.parse({
      eventId: '018f8f5b-0000-7000-8000-000000000002',
      title: 'Robot Night',
      summary: 'Robots.',
      description: 'A night of robots.',
      eventType: 'Workshop',
      audience: 'All students',
      startsAt: '2026-10-01T12:00:00Z',
      endsAt: '2026-10-01T14:00:00Z',
      registrationOpensAt: '2026-09-01T00:00:00Z',
      registrationClosesAt: '2026-09-30T00:00:00Z',
      capacity: 30,
    });
    expect(parsed.timezone).toBe('Asia/Dubai');
    expect(parsed.waitlistEnabled).toBe(true);
    expect(parsed.requiresClubMembership).toBe(false);
  });

  it('refuses a timezone the runtime cannot resolve', () => {
    // A zone the server cannot format with would throw on every render of
    // the event page rather than at the boundary that accepted it.
    expect(createEventBodySchema.shape.timezone.safeParse('Mars/Olympus').success).toBe(false);
    expect(createEventBodySchema.shape.timezone.safeParse('Europe/London').success).toBe(true);
  });
});

describe('eventListQuerySchema', () => {
  it('coerces the upcoming flag from its query-string form', () => {
    // Query values arrive as strings. z.boolean() would reject 'true'
    // outright and make the filter unreachable from a browser.
    expect(eventListQuerySchema.parse({ upcoming: 'true' }).upcoming).toBe(true);
    expect(eventListQuerySchema.parse({ upcoming: 'false' }).upcoming).toBe(false);
    expect(eventListQuerySchema.parse({}).upcoming).toBeUndefined();
  });

  it('reads fromMyClubs out of a query string, both ways', () => {
    // z.coerce.boolean() is Boolean(input), and Boolean('true') is true too,
    // so a 'true'-only assertion passes against the exact bug being guarded.
    // The 'false' case is what discriminates.
    expect(eventListQuerySchema.parse({ fromMyClubs: 'true' }).fromMyClubs).toBe(true);
    expect(eventListQuerySchema.parse({ fromMyClubs: 'false' }).fromMyClubs).toBe(false);
  });
});

describe('myRegistrationListQuerySchema', () => {
  it('reads past out of a query string, and leaves it undefined when absent', () => {
    // The 'false' case discriminates: z.coerce.boolean() is Boolean(input),
    // and Boolean('false') is true (any non-empty string is truthy).
    expect(myRegistrationListQuerySchema.parse({ past: 'true' }).past).toBe(true);
    expect(myRegistrationListQuerySchema.parse({ past: 'false' }).past).toBe(false);
    expect(myRegistrationListQuerySchema.parse({}).past).toBeUndefined();
  });
});
