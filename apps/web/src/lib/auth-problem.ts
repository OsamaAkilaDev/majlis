import type { ProblemError } from '@/lib/api';

export type RoutedProblem = {
  /** Keyed by the form control the message belongs on. */
  fields: Record<string, string>;
  /** Everything naming no single control, including a request that never landed. */
  form: string | null;
};

const FIELDS = {
  login: ['email', 'password'],
  signup: ['fullName', 'email', 'password'],
  setup: ['fullName', 'email', 'password'],
  forgot: ['email'],
  // No token: a path listed here that nothing renders writes a message to a
  // control the user cannot see.
  reset: ['password'],
} as const;

// Which control a bare 401 belongs on. `reset` is null deliberately: the
// failing credential is the link, not a control, and putting "this link is no
// longer valid" under the new password sends the user to fix the wrong field.
const UNAUTHORIZED_FIELD: Record<keyof typeof FIELDS, string | null> = {
  login: 'password',
  signup: 'password',
  setup: 'password',
  forgot: 'email',
  reset: null,
};

/**
 * Places a failure where the user can act on it, in the API's own words.
 * Nothing may be dropped: a message mapping to no rendered control still has
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
