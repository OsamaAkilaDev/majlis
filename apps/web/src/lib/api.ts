import { problemDetailsSchema, type ProblemFieldError } from '@majlis/contracts';

export const API_BASE = '/api/v1';

const REFRESH_PATH = '/auth/refresh';

/**
 * Paths where a 401 is an answer the caller renders rather than a dead
 * session: a wrong password, a probe for the current viewer, the refresh
 * itself.
 */
const OWN_401 = [
  '/auth/login',
  '/auth/signup',
  '/auth/me',
  // An expired or already-used reset link answers 401, and it is the one
  // thing that screen exists to report. Redirecting to /login instead throws
  // away the message and leaves the visitor, who by definition cannot sign
  // in, on the form they came from.
  '/auth/reset-password',
  REFRESH_PATH,
];

export class ProblemError extends Error {
  readonly status: number;
  readonly title: string;
  readonly detail: string | undefined;
  readonly requestId: string | undefined;
  readonly errors: ProblemFieldError[];

  constructor(init: {
    status: number;
    title: string;
    detail?: string;
    requestId?: string;
    errors?: ProblemFieldError[];
  }) {
    super(init.detail ?? init.title);
    this.name = 'ProblemError';
    this.status = init.status;
    this.title = init.title;
    this.detail = init.detail;
    this.requestId = init.requestId;
    this.errors = init.errors ?? [];
  }

  fieldError(path: string): string | undefined {
    return this.errors.find((e) => e.path === path)?.message;
  }
}

async function toProblem(res: Response): Promise<ProblemError> {
  try {
    const parsed = problemDetailsSchema.safeParse(await res.json());
    if (parsed.success) {
      return new ProblemError({
        status: parsed.data.status,
        title: parsed.data.title,
        ...(parsed.data.detail === undefined ? {} : { detail: parsed.data.detail }),
        ...(parsed.data.requestId === undefined ? {} : { requestId: parsed.data.requestId }),
        ...(parsed.data.errors === undefined ? {} : { errors: parsed.data.errors }),
      });
    }
  } catch {
    // A gateway error is HTML, not JSON. Fall through to the status-only form.
  }
  return new ProblemError({ status: res.status, title: res.statusText || 'Request failed' });
}

async function send(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${API_BASE}${path}`, {
    ...init,
    credentials: 'same-origin',
    headers: { accept: 'application/json', ...init?.headers },
  });
}

/**
 * One request, with the refresh retry and the dead-session exit. Everything
 * that talks to the API goes through here; only the decoding differs, which
 * is why the CSV exports are not a second copy of this logic.
 */
async function request(path: string, init?: RequestInit): Promise<Response> {
  let res = await send(path, init);

  // The refresh token does not rotate, so concurrent refreshes are harmless
  // and no client-side dedupe is needed. Retry exactly once, and never from
  // the refresh path itself, which would recurse.
  if (res.status === 401 && path !== REFRESH_PATH) {
    const refreshed = await send(REFRESH_PATH, { method: 'POST' });
    if (refreshed.ok) res = await send(path, init);
  }

  // The refresh token is gone or revoked, and nothing on the screen can
  // recover from that. Ending the session here rather than in each caller is
  // what stops a revoked session from leaving every screen on its skeleton.
  if (res.status === 401 && !OWN_401.includes(path) && typeof window !== 'undefined') {
    window.location.assign('/login');
  }

  if (!res.ok) throw await toProblem(res);
  return res;
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await request(path, init);
  // Read as text and parse only what is there. `res.json()` on an empty body
  // throws SyntaxError, which is not a ProblemError and so reaches the form
  // as "could not reach the server" — on a request that succeeded. A 204 is
  // not the only bodyless success: /auth/forgot-password answers 202.
  const body = await res.text();
  return (body ? JSON.parse(body) : undefined) as T;
}

/** The exports, which answer `text/csv` and are read back for the cap trailer. */
export async function apiText(path: string): Promise<string> {
  return (await request(path)).text();
}

/** A JSON body, for the POST/PATCH/DELETE bodies every client module sends. */
export const json = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

/** Query string from a sparse record; an undefined value is omitted entirely. */
export function qs(params: Record<string, string | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) search.set(key, value);
  }
  const s = search.toString();
  return s ? `?${s}` : '';
}
