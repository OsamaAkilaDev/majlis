import { describe, expect, it } from 'vitest';
import { deriveSlug, uniqueSlug } from './slug';

describe('deriveSlug', () => {
  it('lowercases and hyphenates', () => {
    expect(deriveSlug('Robotics Club')).toBe('robotics-club');
  });

  it('collapses runs of punctuation into a single hyphen', () => {
    // Catches a naive .replace(/\s/g, '-'), which leaves "ai--ml" and
    // "robotics-" with a trailing hyphen.
    expect(deriveSlug('AI  &  ML')).toBe('ai-ml');
    expect(deriveSlug('Robotics!')).toBe('robotics');
    expect(deriveSlug('  Spaced  ')).toBe('spaced');
  });

  it('throws rather than returning an empty slug', () => {
    // Catches a name of only punctuation producing "", which would then
    // collide with every other such club and make an unreachable URL.
    expect(() => deriveSlug('!!!')).toThrow(/slug/i);
  });
});

describe('uniqueSlug', () => {
  it('returns the base when it is free', async () => {
    expect(await uniqueSlug('robotics', async () => false)).toBe('robotics');
  });

  it('suffixes until it finds a free one', async () => {
    // Catches an implementation that appends a fixed -2 and gives up, which
    // fails on the third club with the same name.
    const taken = new Set(['robotics', 'robotics-2', 'robotics-3']);
    expect(await uniqueSlug('robotics', async (s) => taken.has(s))).toBe('robotics-4');
  });
});
