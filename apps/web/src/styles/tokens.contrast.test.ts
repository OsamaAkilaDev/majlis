import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Parsed from `globals.css`, which is the only place these values exist.
 *
 * They used to be duplicated into a `tokens.ts` that nothing but this file
 * imported, so the suite proved a copy met WCAG while the stylesheet the
 * browser actually loads went unchecked: editing a hex in `globals.css` left
 * every assertion below green.
 */
const CSS = readFileSync(new URL('./globals.css', import.meta.url), 'utf8');

export type Theme = Record<string, string>;

function camel(name: string): string {
  const [head, ...rest] = name.split('-');
  return (head ?? '') + rest.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('');
}

/**
 * The six-digit hex custom properties declared in one block of `globals.css`.
 *
 * Scoped to a single `{ … }` so `:root` and `.dark` cannot bleed into each
 * other: a token dropped from `.dark` must come back missing here, not
 * silently inherit the light value and pass.
 *
 * The selector is matched as a RULE, at the start of a line and followed by
 * its brace, not as a substring: `.dark` first occurs inside
 * `@custom-variant dark (&:where(.dark, .dark *))` on line 3, and a plain
 * indexOf walked from there to the `:root` brace and parsed the light
 * palette twice. Every assertion below passed against it.
 */
function block(selector: string): Theme {
  const rule = new RegExp(`^${selector.replace('.', '\\.')}\\s*\\{`, 'm');
  const open = CSS.search(rule);
  if (open === -1) throw new Error(`globals.css has no ${selector} rule`);
  const body = CSS.slice(CSS.indexOf('{', open) + 1, CSS.indexOf('}', open));

  const theme: Theme = {};
  for (const [, name, hex] of body.matchAll(/--([a-z0-9-]+):\s*(#[0-9A-Fa-f]{6})\s*;/g)) {
    theme[camel(name!)] = hex!.toUpperCase();
  }
  return theme;
}

const LIGHT = block(':root');
const DARK = block('.dark');

/**
 * Declared once in `:root` and deliberately NOT redefined in `.dark`: no flat
 * colour clears 3:1 against both the paper surfaces and the deep auth ground,
 * so the focus ring is a fixed gold outline with a fixed ink halo and keeps
 * its own values in either theme.
 */
const FIXED = ['focus', 'focusContrast'];

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

export function luminance(hex: string): number {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** Every token a pair below names, so a typo reads as a missing token, not 1:1. */
function at(theme: Theme, name: string): string {
  const hex = theme[name];
  if (!hex) throw new Error(`globals.css declares no --${name}`);
  return hex;
}

const TEXT = 4.5;
/** SC 1.4.11 non-text contrast: a border or a ring, not a glyph. */
const NON_TEXT = 3;

/** [foreground token, background token, minimum ratio]. */
const PAIRS: Array<[string, string, number]> = [
  ['ink', 'bg', TEXT],
  ['ink', 'surface', TEXT],
  ['ink', 'surface2', TEXT],
  ['ink2', 'bg', TEXT],
  ['ink2', 'surface', TEXT],
  ['ink2', 'surface2', TEXT],
  ['ink3', 'bg', TEXT],
  ['ink3', 'surface', TEXT],
  ['primary', 'bg', TEXT],
  ['primary', 'surface', TEXT],
  ['primaryFg', 'primary', TEXT],
  ['primaryFg', 'primaryHover', TEXT],
  ['primarySoftFg', 'primarySoft', TEXT],
  ['okFg', 'okSoft', TEXT],
  ['warnFg', 'warnSoft', TEXT],
  ['badFg', 'badSoft', TEXT],
  ['infoFg', 'infoSoft', TEXT],
  ['muteFg', 'muteSoft', TEXT],
  ['bad', 'surface', TEXT],
  // The control border must clear its 3:1 against every ground an input can
  // sit on, not just the easiest one.
  ['borderControl', 'bg', NON_TEXT],
  ['borderControl', 'surface', NON_TEXT],
  ['borderControl', 'surface2', NON_TEXT],
  ['primary', 'bg', NON_TEXT],
  ['primary', 'surface', NON_TEXT],
];

/**
 * Object rows, so the title can name the pair AND its threshold. The array
 * form interpolates `%s` positionally, which printed the foreground hex where
 * the ratio belonged: "ink3 on bg meets #7C6F62:1".
 */
function pairs(t: Theme) {
  return PAIRS.map(([fg, bg, min]) => ({
    pair: `${fg} on ${bg}`,
    fg: at(t, fg!),
    bg: at(t, bg!),
    min: min!,
  }));
}

describe.each([
  ['light', LIGHT],
  ['dark', DARK],
])('%s theme contrast', (_name, theme) => {
  // Catches any token edited below its threshold. The first version of this
  // palette shipped borderControl at 1.79:1 against surface in both themes,
  // which this suite would have failed.
  it.each(pairs(theme))('$pair meets $min:1', ({ fg, bg, min }) => {
    expect(contrast(fg, bg)).toBeGreaterThanOrEqual(min);
  });
});

describe('contrast()', () => {
  // Catches a luminance formula with swapped or dropped coefficients: those
  // still return plausible mid-range numbers for most pairs, so only the two
  // known extremes pin the function down.
  it('returns 21 for black on white', () => {
    expect(contrast('#000000', '#FFFFFF')).toBeCloseTo(21, 1);
  });

  it('returns 1 for a colour against itself', () => {
    expect(contrast('#0E5F55', '#0E5F55')).toBeCloseTo(1, 5);
  });

  // Catches an implementation that assumes foreground is always darker.
  it('is symmetric', () => {
    expect(contrast('#FAF7F2', '#1C1713')).toBeCloseTo(contrast('#1C1713', '#FAF7F2'), 10);
  });
});

describe('theme completeness', () => {
  // Catches a token added to :root and forgotten in .dark, which renders as
  // the light value in dark mode and is easy to miss. Derived from the
  // stylesheet rather than listed here, so a token added to both needs no
  // edit and a token added to one fails.
  it('.dark redefines every :root colour but the fixed ones', () => {
    expect(Object.keys(DARK).sort()).toEqual(
      Object.keys(LIGHT)
        .filter((k) => !FIXED.includes(k))
        .sort(),
    );
  });

  // Catches the reverse mistake: giving a deliberately fixed value a dark
  // variant, which is how the focus ring would stop clearing 3:1 on the auth
  // ground without any pair above changing.
  it.each(FIXED)('--%s is declared once, in :root only', (name) => {
    expect(LIGHT[name]).toBeDefined();
    expect(DARK[name]).toBeUndefined();
  });
});
