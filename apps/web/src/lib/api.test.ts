import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiFetch, onMutation, ProblemError, qs } from './api';

type Call = { url: string; init?: RequestInit };

function mockFetch(responses: Array<() => Response>) {
  const calls: Call[] = [];
  let i = 0;
  const fn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const make = responses[Math.min(i, responses.length - 1)];
    i += 1;
    // Test helper only: responses is always non-empty at every call site.
    return make!();
  });
  vi.stubGlobal('fetch', fn);
  return calls;
}

const json = (body: unknown, status = 200, type = 'application/json') =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': type } });

const problem = (status: number, extra: Record<string, unknown> = {}) =>
  json({ type: 'about:blank', title: 'Nope', status, ...extra }, status, 'application/problem+json');

afterEach(() => vi.unstubAllGlobals());

describe('apiFetch', () => {
  it('returns the parsed body on 200', async () => {
    mockFetch([() => json({ id: 'u1' })]);
    await expect(apiFetch<{ id: string }>('/auth/me')).resolves.toEqual({ id: 'u1' });
  });

  it('prefixes the path with /api/v1 and sends credentials', async () => {
    // Catches calling the API origin directly: that bypasses the rewrite, the
    // request goes cross-origin, the cookie stops being sent, and it presents
    // as "randomly logged out".
    const calls = mockFetch([() => json({})]);
    await apiFetch('/auth/me');
    expect(calls[0]?.url).toBe('/api/v1/auth/me');
    expect(calls[0]?.init?.credentials).toBe('same-origin');
  });

  it('throws ProblemError carrying status, title and errors[]', async () => {
    mockFetch([
      () =>
        problem(422, {
          detail: 'Validation failed',
          requestId: 'req-1',
          errors: [{ path: 'email', message: 'Enter a university email address.' }],
        }),
    ]);
    const err = (await apiFetch('/auth/signup', { method: 'POST' }).catch((e) => e)) as ProblemError;
    expect(err).toBeInstanceOf(ProblemError);
    expect(err.status).toBe(422);
    expect(err.requestId).toBe('req-1');
    expect(err.fieldError('email')).toBe('Enter a university email address.');
    expect(err.fieldError('password')).toBeUndefined();
  });

  it('refreshes once and retries the original request on 401', async () => {
    // Catches retrying without refreshing AND refreshing without retrying. A
    // test asserting only the final value passes against both.
    const calls = mockFetch([
      () => problem(401),
      () => json({}),            // refresh
      () => json({ id: 'u1' }),  // retry
    ]);
    await expect(apiFetch<{ id: string }>('/me')).resolves.toEqual({ id: 'u1' });
    expect(calls.map((c) => c.url)).toEqual(['/api/v1/me', '/api/v1/auth/refresh', '/api/v1/me']);
    expect(calls[1]?.init?.method).toBe('POST');
  });

  it('does not retry more than once when the retry also 401s', async () => {
    // Catches a recursive retry: the mock clamps on its last entry, so the
    // length assertion is what stops it. Three calls is exactly one retry.
    const calls = mockFetch([() => problem(401), () => json({}), () => problem(401)]);
    await expect(apiFetch('/me')).rejects.toBeInstanceOf(ProblemError);
    expect(calls).toHaveLength(3);
  });

  it('does not attempt a refresh when the refresh endpoint itself 401s', async () => {
    // Catches infinite recursion through the refresh path specifically.
    const calls = mockFetch([() => problem(401)]);
    await expect(apiFetch('/auth/refresh', { method: 'POST' })).rejects.toBeInstanceOf(ProblemError);
    expect(calls).toHaveLength(1);
  });

  it('throws ProblemError on a non-JSON 500 rather than a parse error', async () => {
    // Catches an unguarded res.json(): a gateway 500 is HTML, and the
    // SyntaxError loses the status and renders as a blank screen.
    mockFetch([() => new Response('<html>502</html>', { status: 502, headers: { 'content-type': 'text/html' } })]);
    const err = (await apiFetch('/me').catch((e) => e)) as ProblemError;
    expect(err).toBeInstanceOf(ProblemError);
    expect(err.status).toBe(502);
    expect(err.errors).toEqual([]);
  });

  it('sends a session that cannot be refreshed to /login', async () => {
    // A promise rejected inside a load() effect reaches no error boundary, so
    // a revoked refresh token has to end the session here or the screen stays
    // on its skeleton forever.
    const assign = vi.fn();
    vi.stubGlobal('window', { location: { assign } });
    mockFetch([() => problem(401), () => json({}), () => problem(401)]);
    await expect(apiFetch('/me/certificates')).rejects.toBeInstanceOf(ProblemError);
    expect(assign).toHaveBeenCalledWith('/login');
  });

  it('leaves a wrong password on the sign-in form rather than reloading it', async () => {
    // Catches redirecting on every 401: /auth/login answers 401 to a wrong
    // password, and navigating away throws the message away with it.
    const assign = vi.fn();
    vi.stubGlobal('window', { location: { assign } });
    mockFetch([() => problem(401, { detail: 'Email or password is incorrect.' })]);
    await expect(apiFetch('/auth/login', { method: 'POST' })).rejects.toBeInstanceOf(ProblemError);
    expect(assign).not.toHaveBeenCalled();
  });

  it('returns undefined for a 204', async () => {
    // Catches res.json() on an empty body, which logout returns.
    mockFetch([() => new Response(null, { status: 204 })]);
    await expect(apiFetch('/auth/logout', { method: 'POST' })).resolves.toBeUndefined();
  });

  it('returns undefined for a bodyless 202, not a parse error', async () => {
    // /auth/forgot-password answers 202 with no body. A 204-only special case
    // threw SyntaxError, which is not a ProblemError, so the form reported
    // "could not reach the server" on a request that had just succeeded.
    mockFetch([() => new Response(null, { status: 202 })]);
    await expect(apiFetch('/auth/forgot-password', { method: 'POST' })).resolves.toBeUndefined();
  });
});

describe('onMutation', () => {
  it('fires after a mutation succeeds', async () => {
    // Catches the invalidator never being wired up: register for an event, go
    // back to the cached /events, and the seat count predates your booking.
    const invalidate = vi.fn();
    onMutation(invalidate);
    mockFetch([() => json({ id: 'r1' })]);
    await apiFetch('/events/e1/registrations', { method: 'POST' });
    expect(invalidate).toHaveBeenCalledTimes(1);
  });

  it('does not fire for a read', async () => {
    // Catches an implementation that invalidates on every request. That
    // refreshes the router on every page's own data load, which throws the
    // Router Cache away as fast as it fills and re-renders in a loop.
    const invalidate = vi.fn();
    onMutation(invalidate);
    mockFetch([() => json({ items: [] })]);
    await apiFetch('/events?upcoming=true');
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('does not fire when the mutation is refused', async () => {
    // Catches invalidating before the status check. A 422 changed nothing on
    // the server, so discarding every cached page for it is pure cost, paid
    // again on each re-submit of a form the user is still fixing.
    const invalidate = vi.fn();
    onMutation(invalidate);
    mockFetch([() => problem(422)]);
    await expect(apiFetch('/clubs', { method: 'POST' })).rejects.toBeInstanceOf(ProblemError);
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('fires once, not twice, when a mutation is retried after a 401', async () => {
    // Catches the call being placed in send() rather than request(). Both
    // pass the test above; only this one separates them, and a double refresh
    // is a second full RSC render of the page on every expired-token write.
    const invalidate = vi.fn();
    onMutation(invalidate);
    mockFetch([() => problem(401), () => json({}), () => json({ id: 'r1' })]);
    await apiFetch('/events/e1/registrations', { method: 'POST' });
    expect(invalidate).toHaveBeenCalledTimes(1);
  });
});

describe('qs', () => {
  it('omits an undefined value rather than sending the string "undefined"', () => {
    expect(qs({ status: undefined, q: 'robotics' })).toBe('?q=robotics');
  });

  it('is empty when every value is undefined', () => {
    expect(qs({ cursor: undefined })).toBe('');
  });

  // The two cases a truthiness check gets wrong. Every list query used to
  // stringify at the call site to dodge them, and `upcoming=false` silently
  // becoming "no filter" is a list showing past events to a student who asked
  // for neither.
  it('keeps a false boolean', () => {
    expect(qs({ upcoming: false })).toBe('?upcoming=false');
  });

  it('keeps a zero', () => {
    expect(qs({ limit: 0 })).toBe('?limit=0');
  });

  it('stringifies numbers and booleans', () => {
    expect(qs({ limit: 20, unread: true })).toBe('?limit=20&unread=true');
  });

  it('percent-encodes a value', () => {
    expect(qs({ q: 'a b&c' })).toBe('?q=a+b%26c');
  });
});
