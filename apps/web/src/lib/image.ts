import { IMAGE_KINDS, type ImageKind } from '@majlis/contracts';

/** Refused without decoding, so a huge file cannot exhaust memory first. */
export const MAX_SOURCE_BYTES = 10 * 1024 * 1024;

const QUALITY_LADDER = [0.82, 0.7, 0.6];

export function fitBox(
  source: { w: number; h: number },
  box: { w: number; h: number },
  square: boolean,
): { w: number; h: number } {
  if (square) {
    const side = Math.min(source.w, source.h, box.w);
    return { w: side, h: side };
  }
  // Never above 1: an image smaller than the box stays its own size.
  const scale = Math.min(box.w / source.w, box.h / source.h, 1);
  return { w: Math.round(source.w * scale), h: Math.round(source.h * scale) };
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
  const target = fitBox({ w: bitmap.width, h: bitmap.height }, spec.box, spec.square);

  const canvas = document.createElement('canvas');
  canvas.width = target.w;
  canvas.height = target.h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This browser cannot process images.');

  if (spec.square) {
    // Centre crop: take the largest centred square of the source.
    const side = Math.min(bitmap.width, bitmap.height);
    const sx = (bitmap.width - side) / 2;
    const sy = (bitmap.height - side) / 2;
    ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, target.w, target.h);
  } else {
    ctx.drawImage(bitmap, 0, 0, target.w, target.h);
  }
  bitmap.close();

  for (const quality of QUALITY_LADDER) {
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/webp', quality),
    );
    if (blob && blob.size <= spec.maxBytes) return blob;
  }

  throw new Error('That image is too detailed to compress. Choose a simpler one.');
}
