import { IMAGE_KINDS, imageAspectRatio } from '@majlis/contracts';
import { describe, expect, it } from 'vitest';
import { cropToBox, MAX_SOURCE_BYTES } from './image';

describe('cropToBox', () => {
  it('crops a too-wide source to the box ratio, centred', () => {
    // 3200x800 is 4:1 against a 8:3 box, so the height is what fits and the
    // sides are trimmed. Catches a plain scale, which would letterbox instead.
    const crop = cropToBox({ w: 3200, h: 800 }, { w: 1600, h: 600 });
    expect(crop.sh).toBeCloseTo(800);
    expect(crop.sw).toBeCloseTo((800 * 1600) / 600);
    expect(crop.sx).toBeCloseTo((3200 - (800 * 1600) / 600) / 2);
    expect(crop.sy).toBeCloseTo(0);
  });

  it('crops a too-tall source to the box ratio, centred', () => {
    const crop = cropToBox({ w: 800, h: 3200 }, { w: 1600, h: 400 });
    expect({ sw: crop.sw, sh: crop.sh }).toEqual({ sw: 800, sh: 200 });
    expect(crop.sx).toBe(0);
    expect(crop.sy).toBe((3200 - 200) / 2);
  });

  it('scales the crop down to the box', () => {
    expect(cropToBox({ w: 4000, h: 1000 }, { w: 1600, h: 400 })).toMatchObject({ w: 1600, h: 400 });
  });

  it('does not upscale a source smaller than the box', () => {
    // Catches a naive scale factor of box.w / source.w, which blows a 100px
    // logo up to 512px and makes it blurry for no benefit.
    expect(cropToBox({ w: 100, h: 80 }, { w: 512, h: 512 })).toMatchObject({ w: 80, h: 80 });
  });

  it('gives a square box a square crop without a flag for it', () => {
    // The logo used to need `square: true`. Its box is 512x512, so the same
    // arithmetic produces the centred square.
    expect(cropToBox({ w: 1000, h: 400 }, { w: 512, h: 512 })).toMatchObject({ w: 400, h: 400 });
    expect(cropToBox({ w: 300, h: 900 }, { w: 512, h: 512 })).toMatchObject({ w: 300, h: 300 });
  });

  it('caps a square kind at the box size', () => {
    expect(cropToBox({ w: 4000, h: 4000 }, { w: 512, h: 512 })).toMatchObject({ w: 512, h: 512 });
  });

  it('always produces the box ratio, whatever it was handed', () => {
    // The whole point: a screen reserves one shape for a banner and the bytes
    // that arrive are that shape.
    for (const source of [
      { w: 4000, h: 10 },
      { w: 10, h: 4000 },
      { w: 1600, h: 400 },
      { w: 333, h: 777 },
    ]) {
      const crop = cropToBox(source, IMAGE_KINDS['club-banner'].box);
      expect(crop.sw / crop.sh).toBeCloseTo(4, 6);
    }
  });
});

describe('imageAspectRatio', () => {
  it('is the box, so CSS reserves exactly what the upload produces', () => {
    expect(imageAspectRatio('club-banner')).toBe('1600 / 400');
    expect(imageAspectRatio('club-logo')).toBe('512 / 512');
  });
});

describe('MAX_SOURCE_BYTES', () => {
  it('is large enough for a phone photo and small enough to refuse before decoding', () => {
    expect(MAX_SOURCE_BYTES).toBe(10 * 1024 * 1024);
  });
});
