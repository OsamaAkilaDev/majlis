import { PASSWORD_MIN } from '@majlis/contracts/constants';

/** Segments in the meter, and the top score. */
export const STRENGTH_STEPS = 4;

export type PasswordStrength = {
  score: number;
  label: string;
  /** Whether the one rule the contract actually enforces is satisfied. */
  met: boolean;
};

const CLASSES = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/];

const GRADES = ['', 'Weak', 'Fair', 'Good', 'Strong'] as const;

function grade(score: number): string {
  return GRADES[Math.min(Math.max(score, 0), STRENGTH_STEPS) as 0 | 1 | 2 | 3 | 4];
}

/**
 * Advisory, and never a gate: `resetPasswordBodySchema` enforces length and
 * nothing else, so a meter that blocked submit would refuse passwords the API
 * accepts, on a screen with no way to argue back.
 *
 * Length dominates and variety only lifts. Weighted the other way it rates
 * "Passw0rd!" above "correct horse battery staple", training people toward the
 * worse password.
 */
export function passwordStrength(password: string): PasswordStrength {
  if (password.length < PASSWORD_MIN) {
    return {
      score: password.length === 0 ? 0 : 1,
      label: `${PASSWORD_MIN}+ characters`,
      met: false,
    };
  }

  let score = 1;
  if (password.length >= PASSWORD_MIN + 2) score = 2;
  if (password.length >= PASSWORD_MIN + 6) score = 3;
  if (password.length >= PASSWORD_MIN + 12) score = 4;

  const classes = CLASSES.filter((re) => re.test(password)).length;
  if (classes >= 3) score = Math.min(score + 1, STRENGTH_STEPS);

  // Long and repetitive is neither: without this, sixteen of the same letter
  // scores as well as sixteen chosen ones.
  if (new Set(password).size <= 4) score = 1;

  return { score, label: grade(score), met: true };
}
