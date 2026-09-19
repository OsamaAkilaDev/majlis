import type { ImageKind } from '@majlis/contracts';

// Public: logos, banners and posters are branding rendered inline on ordinary
// pages, and signing each would mean a round trip per image on every list read.
export const STORAGE_BUCKET = 'majlis-storage';

/**
 * Private, and separate for that reason: a certificate path is a pure function
 * of its id, so in a public bucket `/object/public/...` is readable with no
 * cookie. Signing alone does not fix that, the bucket has to refuse the
 * unsigned path. Verified live: anonymous reads here answer 400.
 */
export const CERTIFICATE_BUCKET = 'majlis-certificates';

// Folder and deterministic file name per kind. Caps live in @majlis/contracts.
const PATHS = {
  'club-logo': { folder: 'clubs', file: 'logo.webp' },
  'club-banner': { folder: 'clubs', file: 'banner.webp' },
  'event-poster': { folder: 'events', file: 'poster.webp' },
} as const satisfies Record<ImageKind, { folder: string; file: string }>;

/** A resource id may only ever be a bare UUID segment. */
const SAFE_SEGMENT = /^[A-Za-z0-9-]{1,64}$/;

// The only place an object path is built. The id arrives from a request
// parameter, so a separator or dot segment in it would write into a folder the
// caller was never authorized for.
export function objectPath(kind: ImageKind, resourceId: string): string {
  if (!SAFE_SEGMENT.test(resourceId)) {
    throw new Error(`Unsafe resource id for a storage path: ${JSON.stringify(resourceId)}`);
  }
  const spec = PATHS[kind];
  return `${spec.folder}/${resourceId}/${spec.file}`;
}

// Deliberately not an `ImageKind`: no signed upload URL is ever minted for it
// and the bytes only arrive from the API's own renderer. Still SAFE_SEGMENT,
// because the id arrives from a request parameter.
export function certificatePdfPath(certificateId: string): string {
  if (!SAFE_SEGMENT.test(certificateId)) {
    throw new Error(`Unsafe certificate id for a storage path: ${JSON.stringify(certificateId)}`);
  }
  return `certificates/${certificateId}/certificate.pdf`;
}

// Object names are deterministic, so a replacement reuses the same name. The
// version query is the only thing stopping a CDN or browser from serving the
// previous bytes forever.
export function publicUrl(baseUrl: string, path: string, version: number): string {
  const base = baseUrl.replace(/\/+$/, '');
  return `${base}/storage/v1/object/public/${STORAGE_BUCKET}/${path}?v=${version}`;
}
