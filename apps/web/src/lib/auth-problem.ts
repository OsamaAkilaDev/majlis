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
  setup: ['fullName', 'email', 'password'],
  forgot: ['email'],
  // No token. It left the reset form when the link started being resolved on
  // the server, and a path listed here that nothing renders is a message
  // written to a control the user cannot see.
  reset: ['password'],
} as const;

/**
 * Which control a bare 401 belongs on, or null for the form itself.
 *
 * On the sign-in form it is the password. On the reset form it is nothing:
 * the failing credential is the link, which is no longer a control, and
 * putting "This reset link is no longer valid" under the new password sends
 * the user to change a field that was never the problem. null sends it to the
 * form-level alert, which is the only place left that can carry it.
 */
const UNAUTHORIZED_FIELD: Record<keyof typeof FIELDS, string | null> = {
  login: 'password',
  signup: 'password',
  // Unreachable in practice: POST /auth/bootstrap has no 401 to answer with.
  setup: 'password',
  forgot: 'email',
  reset: null,
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
    const on = UNAUTHORIZED_FIELD[mode];
    if (problem.status === 401 && on) fields[on] = detail;
    if (problem.status === 409) fields.email = detail;
  }

  if (orphans.length > 0) return { fields, form: orphans.join(' ') };
  return { fields, form: Object.keys(fields).length === 0 ? detail : null };
}
