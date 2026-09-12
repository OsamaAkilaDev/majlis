import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { BRAND } from './brand';

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

describe('BRAND', () => {
  it('matches the theme colour shipped in globals.css', () => {
    // Catches the manifest and the CSS drifting apart, which shows up only as
    // a wrong browser chrome colour on an installed PWA and is never noticed.
    const css = readFileSync('src/styles/globals.css', 'utf8');
    expect(css).toContain(BRAND.themeColor);
  });

  it('is the only place the product name is written', () => {
    // Catches a component hardcoding "Majlis", which spec 9.5 forbids so a
    // rename stays one line. A test that only asserted BRAND.product === 'Majlis'
    // would pass against a codebase that hardcodes the name in twenty files.
    const offenders = walk('src')
      .filter((f) => /\.tsx?$/.test(f) && !f.endsWith('brand.ts') && !f.endsWith('brand.test.ts'))
      .filter((f) => readFileSync(f, 'utf8').includes('Majlis'));
    expect(offenders).toEqual([]);
  });
});
