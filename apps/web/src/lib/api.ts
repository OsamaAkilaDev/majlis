import { problemDetailsSchema, type ProblemFieldError } from '@majlis/contracts';

export const API_BASE = '/api/v1';

const REFRESH_PATH = '/auth/refresh';

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

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  let res = await send(path, init);

  // The refresh token does not rotate, so concurrent refreshes are harmless
  // and no client-side dedupe is needed. Retry exactly once, and never from
  // the refresh path itself, which would recurse.
  if (res.status === 401 && path !== REFRESH_PATH) {
    const refreshed = await send(REFRESH_PATH, { method: 'POST' });
    if (refreshed.ok) res = await send(path, init);
  }

  if (!res.ok) throw await toProblem(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
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
