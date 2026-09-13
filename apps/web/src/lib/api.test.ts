import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiFetch, ProblemError } from './api';

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
    // Catches a client that calls the API origin directly. That bypasses the
    // rewrite, makes the request cross-origin, and the session cookie stops
    // being sent at all, which presents as "randomly logged out".
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
    // Catches both halves of the contract. An implementation that retries
    // without refreshing, or refreshes without retrying, fails here; a test
    // that only asserted the final value would pass against both.
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
    // Catches a recursive retry. The mock clamps on its last entry, so an
    // implementation that retries on every 401 keeps calling and the length
    // assertion is what stops it. Three calls is exactly one retry.
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
    // Catches an unguarded res.json(). A proxy or gateway 500 is HTML, and an
    // unguarded parse throws SyntaxError, which loses the status entirely and
    // renders as a blank screen rather than an error state.
    mockFetch([() => new Response('<html>502</html>', { status: 502, headers: { 'content-type': 'text/html' } })]);
    const err = (await apiFetch('/me').catch((e) => e)) as ProblemError;
    expect(err).toBeInstanceOf(ProblemError);
    expect(err.status).toBe(502);
    expect(err.errors).toEqual([]);
  });

  it('sends a session that cannot be refreshed to /login', async () => {
    // The skeleton-forever defect the Stage 5 handoff names first. A promise
    // rejected inside a load() effect reaches no error boundary, so a revoked
    // refresh token has to end the session here or the screen never recovers.
    const assign = vi.fn();
    vi.stubGlobal('window', { location: { assign } });
    mockFetch([() => problem(401), () => json({}), () => problem(401)]);
    await expect(apiFetch('/me/certificates')).rejects.toBeInstanceOf(ProblemError);
    expect(assign).toHaveBeenCalledWith('/login');
  });

  it('leaves a wrong password on the sign-in form rather than reloading it', async () => {
    // Catches a redirect that fires for every 401. /auth/login answers 401 to
    // a wrong password, and navigating away from the form throws the message
    // the user needed to read.
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
    // let res.json() throw SyntaxError here, which is not a ProblemError, so
    // the form reported "could not reach the server" on a request that had
    // just succeeded.
    mockFetch([() => new Response(null, { status: 202 })]);
    await expect(apiFetch('/auth/forgot-password', { method: 'POST' })).resolves.toBeUndefined();
  });
});
