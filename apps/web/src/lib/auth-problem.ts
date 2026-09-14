import type { ProblemError } from '@/lib/api';

export type RoutedProblem = {
  /** Keyed by the form control the message belongs on. */
  fields: Record<string, string>;
  /** Everything that names no single control, including a request that never landed. */
  form: string | null;
};

const FIELDS = {
  login: ['email', 'password'],
  signup: ['fullName', 'email', 'password'],
  forgot: ['email'],
  reset: ['token', 'password'],
} as const;

/**
 * Which control a bare 401 belongs on. On the sign-in form it is the
 * password; on the reset form it is the link, and putting "This reset link is
 * no longer valid" under the new password sends the user to change a field
 * that was never the problem.
 */
const UNAUTHORIZED_FIELD: Record<keyof typeof FIELDS, string> = {
  login: 'password',
  signup: 'password',
  forgot: 'email',
  reset: 'token',
};

/**
 * Places a failure where the user can act on it, and always in the API's own
 * words: a rewritten message drifts from the server the moment either changes.
 * Nothing may be dropped: a message that maps to no rendered control still has
 * to reach the form, or the submit silently does nothing.
 */
export function routeProblem(
  mode: keyof typeof FIELDS,
  problem: ProblemError | null,
  networkError: string | null,
): RoutedProblem {
  if (networkError) return { fields: {}, form: networkError };
  if (!problem) return { fields: {}, form: null };

  const known: readonly string[] = FIELDS[mode];
  const fields: Record<string, string> = {};
  const orphans: string[] = [];
  for (const error of problem.errors) {
    if (known.includes(error.path)) fields[error.path] ??= error.message;
    else orphans.push(error.message);
  }

  // A 401 and a 409 carry no errors[], but each still names one control.
  const detail = problem.detail ?? problem.title;
  if (problem.errors.length === 0) {
    if (problem.status === 401) fields[UNAUTHORIZED_FIELD[mode]] = detail;
    if (problem.status === 409) fields.email = detail;
  }

  if (orphans.length > 0) return { fields, form: orphans.join(' ') };
  return { fields, form: Object.keys(fields).length === 0 ? detail : null };
}
