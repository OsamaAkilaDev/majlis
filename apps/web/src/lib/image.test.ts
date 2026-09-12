import { describe, expect, it } from 'vitest';
import { fitBox, MAX_SOURCE_BYTES } from './image';

describe('fitBox', () => {
  it('scales a landscape image down to fit the box, preserving ratio', () => {
    expect(fitBox({ w: 3200, h: 1200 }, { w: 1600, h: 600 }, false)).toEqual({ w: 1600, h: 600 });
    expect(fitBox({ w: 3200, h: 800 }, { w: 1600, h: 600 }, false)).toEqual({ w: 1600, h: 400 });
  });

  it('does not upscale an image smaller than the box', () => {
    // Catches a naive scale factor of box.w / source.w, which blows a
    // 100px logo up to 512px and makes it blurry for no benefit.
    expect(fitBox({ w: 100, h: 80 }, { w: 512, h: 512 }, false)).toEqual({ w: 100, h: 80 });
  });

  it('returns a square for a square kind, cropping the long side', () => {
    expect(fitBox({ w: 1000, h: 400 }, { w: 512, h: 512 }, true)).toEqual({ w: 400, h: 400 });
    expect(fitBox({ w: 300, h: 900 }, { w: 512, h: 512 }, true)).toEqual({ w: 300, h: 300 });
  });

  it('caps a square kind at the box size', () => {
    expect(fitBox({ w: 4000, h: 4000 }, { w: 512, h: 512 }, true)).toEqual({ w: 512, h: 512 });
  });
});

describe('MAX_SOURCE_BYTES', () => {
  it('is large enough for a phone photo and small enough to refuse before decoding', () => {
    expect(MAX_SOURCE_BYTES).toBe(10 * 1024 * 1024);
  });
});
