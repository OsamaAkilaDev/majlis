import { IMAGE_KINDS, type ImageKind } from '@majlis/contracts';

/** Refused without decoding, so a huge file cannot exhaust memory first. */
export const MAX_SOURCE_BYTES = 10 * 1024 * 1024;

const QUALITY_LADDER = [0.82, 0.7, 0.6];

export interface Crop {
  /** The source rectangle to read. */
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  /** The canvas to draw it onto. */
  w: number;
  h: number;
}

/**
 * The largest centred rectangle of `source` at the box's own ratio, scaled to
 * fit the box and never above its own size.
 *
 * One path for every kind: the logo's box is square, so the square crop falls
 * out of the same arithmetic rather than needing a flag of its own.
 */
export function cropToBox(source: { w: number; h: number }, box: { w: number; h: number }): Crop {
  const ratio = box.w / box.h;

  // Whichever side runs out first at that ratio decides the crop.
  const sw = Math.min(source.w, source.h * ratio);
  const sh = sw / ratio;

  // Never above 1: an image smaller than the box stays its own size.
  const scale = Math.min(box.w / sw, 1);

  return {
    sx: (source.w - sw) / 2,
    sy: (source.h - sh) / 2,
    sw,
    sh,
    w: Math.round(sw * scale),
    h: Math.round(sh * scale),
  };
}

/**
 * Resize and re-encode in the browser. The API never sees these bytes, so
 * the bucket's own 2 MB and image/webp restrictions are the enforcement;
 * this is what makes a normal upload land well under them.
 */
export async function convertToWebp(file: File, kind: ImageKind): Promise<Blob> {
  if (file.size > MAX_SOURCE_BYTES) {
    throw new Error('That file is over 10 MB. Choose a smaller one.');
  }

  const spec = IMAGE_KINDS[kind];
  const bitmap = await createImageBitmap(file);
  const crop = cropToBox({ w: bitmap.width, h: bitmap.height }, spec.box);

  const canvas = document.createElement('canvas');
  canvas.width = crop.w;
  canvas.height = crop.h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This browser cannot process images.');

  ctx.drawImage(bitmap, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, crop.w, crop.h);
  bitmap.close();

  for (const quality of QUALITY_LADDER) {
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/webp', quality),
    );
    if (blob && blob.size <= spec.maxBytes) return blob;
  }

  throw new Error('That image is too detailed to compress. Choose a simpler one.');
}
