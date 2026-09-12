import { describe, expect, it } from 'vitest';
import { DARK, LIGHT, type Theme } from './tokens';

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

// [label, foreground, background, minimum]
function pairs(t: Theme): Array<[string, string, string, number]> {
  return [
    ['ink on bg', t.ink, t.bg, 4.5],
    ['ink on surface', t.ink, t.surface, 4.5],
    ['ink on surface2', t.ink, t.surface2, 4.5],
    ['ink2 on bg', t.ink2, t.bg, 4.5],
    ['ink2 on surface', t.ink2, t.surface, 4.5],
    ['ink2 on surface2', t.ink2, t.surface2, 4.5],
    ['ink3 on bg', t.ink3, t.bg, 4.5],
    ['ink3 on surface', t.ink3, t.surface, 4.5],
    ['primary on bg', t.primary, t.bg, 4.5],
    ['primary on surface', t.primary, t.surface, 4.5],
    ['primaryFg on primary', t.primaryFg, t.primary, 4.5],
    ['primaryFg on primaryHover', t.primaryFg, t.primaryHover, 4.5],
    ['primarySoftFg on primarySoft', t.primarySoftFg, t.primarySoft, 4.5],
    ['okFg on okSoft', t.okFg, t.okSoft, 4.5],
    ['warnFg on warnSoft', t.warnFg, t.warnSoft, 4.5],
    ['badFg on badSoft', t.badFg, t.badSoft, 4.5],
    ['infoFg on infoSoft', t.infoFg, t.infoSoft, 4.5],
    ['muteFg on muteSoft', t.muteFg, t.muteSoft, 4.5],
    ['bad on surface', t.bad, t.surface, 4.5],
    // SC 1.4.11: non-text contrast. 3:1, and the control border must clear it
    // against every ground an input can sit on, not just the easiest one.
    ['borderControl on bg', t.borderControl, t.bg, 3],
    ['borderControl on surface', t.borderControl, t.surface, 3],
    ['borderControl on surface2', t.borderControl, t.surface2, 3],
    ['focus ring (primary) on bg', t.primary, t.bg, 3],
    ['focus ring (primary) on surface', t.primary, t.surface, 3],
  ];
}

describe.each([
  ['light', LIGHT as Theme],
  ['dark', DARK],
])('%s theme contrast', (_name, theme) => {
  // Catches any token edited below its threshold. The first version of this
  // palette shipped borderControl at 1.79:1 against surface in both themes,
  // which this suite would have failed.
  it.each(pairs(theme))('%s meets %s:1', (_label, fg, bg, min) => {
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
  // Catches a token added to light and forgotten in dark, which renders as an
  // unstyled or inherited colour only in dark mode and is easy to miss.
  it('dark defines every light token', () => {
    expect(Object.keys(DARK).sort()).toEqual(Object.keys(LIGHT).sort());
  });
});
