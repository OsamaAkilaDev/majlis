import type { ImageKind } from '@majlis/contracts';

/**
 * Club logos, banners and event posters. Public, because every one of them
 * is branding that the product renders inline on ordinary pages, and signing
 * each would mean a round trip per image on every list read.
 */
export const STORAGE_BUCKET = 'majlis-storage';

/**
 * Certificates, and nothing else. A separate bucket because it is **private**
 * and the other one cannot be: a certificate is a credential document
 * carrying a person's name, its object path is a pure function of the
 * certificate id, and every holder of `registration:read` can list those ids.
 * In a public bucket that makes `/object/public/...` readable with no cookie
 * at all, which is exactly what the ownership check in `pdf()` exists to
 * prevent. Signing the URL alone does not fix that; the bucket has to refuse
 * the unsigned path, and a public bucket never will.
 *
 * Verified live 2026-09-13: anonymous `/object/public/` answers 400 here, a
 * signed URL answers 200, and a tampered token answers 400.
 */
export const CERTIFICATE_BUCKET = 'majlis-certificates';

/** Folder and deterministic file name per kind. Caps live in @majlis/contracts. */
const PATHS = {
  'club-logo': { folder: 'clubs', file: 'logo.webp' },
  'club-banner': { folder: 'clubs', file: 'banner.webp' },
  'event-poster': { folder: 'events', file: 'poster.webp' },
} as const satisfies Record<ImageKind, { folder: string; file: string }>;

/** A resource id may only ever be a bare UUID segment. */
const SAFE_SEGMENT = /^[A-Za-z0-9-]{1,64}$/;

/**
 * The only place an object path is built. The resource id arrives from a
 * request parameter, so a value containing a separator or a dot segment
 * would write into a folder the caller was never authorized for.
 */
export function objectPath(kind: ImageKind, resourceId: string): string {
  if (!SAFE_SEGMENT.test(resourceId)) {
    throw new Error(`Unsafe resource id for a storage path: ${JSON.stringify(resourceId)}`);
  }
  const spec = PATHS[kind];
  return `${spec.folder}/${resourceId}/${spec.file}`;
}

/**
 * A certificate's rendered PDF. Deliberately not an `ImageKind`: nothing
 * about it is an image, no signed upload URL is ever minted for it, and the
 * bytes only ever arrive from the API's own renderer. It shares
 * SAFE_SEGMENT because the id still arrives from a request parameter.
 */
export function certificatePdfPath(certificateId: string): string {
  if (!SAFE_SEGMENT.test(certificateId)) {
    throw new Error(`Unsafe certificate id for a storage path: ${JSON.stringify(certificateId)}`);
  }
  return `certificates/${certificateId}/certificate.pdf`;
}

/**
 * Object names are deterministic, so replacing an image reuses the same
 * name. The version query is what makes the replacement a different URL,
 * which is the only thing stopping a CDN or a browser from serving the
 * previous bytes forever.
 */
export function publicUrl(baseUrl: string, path: string, version: number): string {
  const base = baseUrl.replace(/\/+$/, '');
  return `${base}/storage/v1/object/public/${STORAGE_BUCKET}/${path}?v=${version}`;
}
