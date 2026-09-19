import { problemDetailsSchema, type ProblemFieldError } from '@majlis/contracts/problem';

export const API_BASE = '/api/v1';

const REFRESH_PATH = '/auth/refresh';

// Paths where a 401 is an answer the caller renders, not a dead session. The
// reset route is here because an expired link answers 401 and that message is
// the only thing that screen exists to report.
const OWN_401 = [
  '/auth/login',
  '/auth/signup',
  '/auth/me',
  '/auth/reset-password',
  REFRESH_PATH,
];

// Drops the Router Cache, which next.config.ts lets hold a dynamic page for
// 30s. Registered once, by components/RouterCacheInvalidator.tsx.
let invalidate: (() => void) | undefined;

export function onMutation(fn: () => void): void {
  invalidate = fn;
}

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

/** One request, with the refresh retry and the dead-session exit. */
async function request(path: string, init?: RequestInit): Promise<Response> {
  let res = await send(path, init);

  // Never from the refresh path itself, which would recurse. The token does
  // not rotate, so concurrent refreshes need no dedupe.
  if (res.status === 401 && path !== REFRESH_PATH) {
    const refreshed = await send(REFRESH_PATH, { method: 'POST' });
    if (refreshed.ok) res = await send(path, init);
  }

  // Ended here rather than in each caller, or a revoked session leaves every
  // screen stuck on its skeleton.
  if (res.status === 401 && !OWN_401.includes(path) && typeof window !== 'undefined') {
    window.location.assign('/login');
  }

  if (!res.ok) throw await toProblem(res);

  // Here rather than in send(), so a request retried after a refresh
  // invalidates once rather than twice.
  if (init?.method && init.method !== 'GET') invalidate?.();

  return res;
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await request(path, init);
  // `res.json()` on an empty body throws SyntaxError, which is not a
  // ProblemError and reaches the form as "could not reach the server" on a
  // request that succeeded. 204 is not the only bodyless success; 202 is one.
  const body = await res.text();
  return (body ? JSON.parse(body) : undefined) as T;
}

/** A JSON body, for the POST/PATCH/DELETE bodies every client module sends. */
export const json = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

/** Query string from a sparse record. An undefined value is omitted entirely,
 *  never stringified to "undefined" and sent as a filter. */
export function qs(params: Record<string, string | number | boolean | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) search.set(key, String(value));
  }
  const s = search.toString();
  return s ? `?${s}` : '';
}
