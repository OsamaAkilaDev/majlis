import { describe, expect, it } from 'vitest';
import { PASSWORD_MIN } from '@majlis/contracts/constants';
import { passwordStrength, STRENGTH_STEPS } from './password-strength';

describe('passwordStrength', () => {
  it('shows the rule, not a grade, until the rule is met', () => {
    // The label the signup and reset screens assert on first paint.
    expect(passwordStrength('').label).toBe(`${PASSWORD_MIN}+ characters`);
    expect(passwordStrength('short').met).toBe(false);
    expect(passwordStrength('a'.repeat(PASSWORD_MIN - 1)).met).toBe(false);
  });

  it('fills nothing for an empty field and something for a partial one', () => {
    expect(passwordStrength('').score).toBe(0);
    expect(passwordStrength('a').score).toBeGreaterThan(0);
  });

  it('grades a long passphrase above a short dense one', () => {
    // The test that discriminates. A meter weighted on character variety
    // rather than length rates these the other way round, which is the
    // single most common defect in a password meter.
    const passphrase = passwordStrength('correct horse battery staple');
    const dense = passwordStrength('Passw0rd!aB1');

    expect(passphrase.met && dense.met).toBe(true);
    expect(passphrase.score).toBeGreaterThan(dense.score);
  });

  it('refuses to call a long repetitive password strong', () => {
    // Would score top marks on length alone.
    const repeated = passwordStrength('ababababababababababababab');

    expect(repeated.met).toBe(true);
    expect(repeated.score).toBe(1);
    expect(repeated.label).toBe('Weak');
  });

  it('never exceeds the number of segments the meter draws', () => {
    const best = passwordStrength(`A-very-long-one-with-everything-in-it-0123456789`);

    expect(best.score).toBe(STRENGTH_STEPS);
    expect(best.label).toBe('Strong');
  });
});

describe('the digit class', () => {
  // `/d/` matches the LETTER d. It sat there unnoticed because no test above
  // separates the digit class from the others: "Abcdefgh" scored the digit
  // class for its `d`, and a password of capitals and digits scored none.
  it('counts digits, not the letter d', () => {
    // Lower + upper + digits, no `d` and no symbol. With the literal `/d/`
    // this is two classes and no bump; with `\d` it is three and gets one.
    expect(passwordStrength('Quiet7Morning9Sky').score).toBe(3);
  });

  it('does not credit a d as a digit', () => {
    // Lower + upper only, three `d`s, and no space: a space would satisfy the
    // symbol class and make this three either way. A score of 3 here means
    // the `d` was counted as a digit.
    expect(passwordStrength('AddendumHandle').score).toBe(2);
  });
});
