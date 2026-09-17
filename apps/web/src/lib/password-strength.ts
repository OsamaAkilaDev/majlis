import { PASSWORD_MIN } from '@majlis/contracts/constants';

/** Segments in the meter, and the top score. */
export const STRENGTH_STEPS = 4;

export type PasswordStrength = {
  /** 0 to STRENGTH_STEPS: how many segments are filled. */
  score: number;
  /** What sits on the label row. The rule while it is unmet, the grade after. */
  label: string;
  /** Whether the one rule the contract actually enforces is satisfied. */
  met: boolean;
};

const CLASSES = [/[a-z]/, /[A-Z]/, /d/, /[^A-Za-z0-9]/];

const GRADES = ['', 'Weak', 'Fair', 'Good', 'Strong'] as const;

/** Clamped, so the tuple index is a literal and the lookup cannot be undefined. */
function grade(score: number): string {
  return GRADES[Math.min(Math.max(score, 0), STRENGTH_STEPS) as 0 | 1 | 2 | 3 | 4];
}

/**
 * Advisory, and never a gate. `resetPasswordBodySchema` enforces length and
 * nothing else, so a meter that blocked submit would refuse passwords the API
 * happily accepts, on a screen with no way to argue back.
 *
 * Deliberately not zxcvbn: ~800KB of dictionaries to grade a field a given
 * account fills in roughly once. What that buys over this is catching
 * "passwordpassword", and what it costs is most of the bundle for the whole
 * auth route group.
 *
 * Length dominates, variety only lifts. A meter weighted the other way rates
 * "Passw0rd!" above "correct horse battery staple", which is precisely
 * backwards and trains people toward the worse password.
 */
export function passwordStrength(password: string): PasswordStrength {
  if (password.length < PASSWORD_MIN) {
    return {
      // Empty shows an empty meter; anything typed shows movement toward the
      // rule, which is the only feedback that matters before it is met.
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

  // Long and repetitive is neither. Without this, sixteen of the same letter
  // scores exactly as well as sixteen chosen ones.
  if (new Set(password).size <= 4) score = 1;

  return { score, label: grade(score), met: true };
}
