import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Logger } from 'nestjs-pino';
import type { Env } from '../config/env.schema';
import { STORAGE_BUCKET, publicUrl } from './image-kinds';

/**
 * The Storage REST API directly, not @supabase/supabase-js, which carries auth,
 * realtime and postgrest clients for a handful of HTTP requests. The service
 * role key bypasses row level security entirely: it is read here and nowhere
 * else, never returned in a response, and never logged.
 */
@Injectable()
export class StorageService {
  private readonly baseUrl: string;
  private readonly key: string;

  constructor(
    config: ConfigService<Env, true>,
    private readonly logger: Logger,
  ) {
    this.baseUrl = config.get('SUPABASE_STORAGE_URL', { infer: true }).replace(/\/+$/, '');
    this.key = config.get('SUPABASE_SERVICE_ROLE_KEY', { infer: true });
  }

  private headers(): Record<string, string> {
    return { Authorization: `Bearer ${this.key}`, apikey: this.key };
  }

  // The path is built server-side from an id the request was already
  // authorized against, so the browser cannot choose where its bytes land.
  async createSignedUploadUrl(path: string): Promise<{ signedUrl: string; token: string }> {
    const res = await fetch(`${this.baseUrl}/storage/v1/object/upload/sign/${STORAGE_BUCKET}/${path}`, {
      method: 'POST',
      headers: this.headers(),
    });

    if (!res.ok) {
      // Only the status: the body may echo the service role key back.
      throw new Error(`Storage refused to sign an upload URL: ${res.status}`);
    }

    const body = (await res.json()) as { url?: string };
    if (!body.url) throw new Error('Storage returned no signed URL.');

    // Verified live: `url` comes back relative to /storage/v1, e.g.
    // "/object/upload/sign/<bucket>/<path>?token=...".
    const signedUrl = body.url.startsWith('http') ? body.url : `${this.baseUrl}/storage/v1${body.url}`;
    const token = new URL(signedUrl).searchParams.get('token') ?? '';
    return { signedUrl, token };
  }

  /**
   * What a certificate PDF must be handed out through: its path is a pure
   * function of the certificate id and every holder of `registration:read` can
   * list those ids, so a public URL would make a credential document readable
   * with no cookie at all.
   */
  async createSignedDownloadUrl(
    path: string,
    expiresInSeconds: number,
    bucket: string = STORAGE_BUCKET,
  ): Promise<string> {
    const res = await fetch(`${this.baseUrl}/storage/v1/object/sign/${bucket}/${path}`, {
      method: 'POST',
      headers: { ...this.headers(), 'content-type': 'application/json' },
      body: JSON.stringify({ expiresIn: expiresInSeconds }),
    });

    // Only the status, as above: the body may echo the key back.
    if (!res.ok) throw new Error(`Storage refused to sign a download URL: ${res.status}`);

    const body = (await res.json()) as { signedURL?: string };
    if (!body.signedURL) throw new Error('Storage returned no signed URL.');

    // Verified live: `signedURL` is relative to /storage/v1, same convention as
    // `createSignedUploadUrl`'s `url`. A tampered token answers 400.
    return body.signedURL.startsWith('http') ? body.signedURL : `${this.baseUrl}/storage/v1${body.signedURL}`;
  }

  // Lets a handler refuse to store a URL for an upload that never happened,
  // which matters because the API never sees the bytes.
  async statObject(path: string): Promise<{ size: number; contentType: string } | null> {
    const res = await fetch(`${this.baseUrl}/storage/v1/object/public/${STORAGE_BUCKET}/${path}`, {
      method: 'HEAD',
    });
    if (res.status === 404) return null;
    // Verified live: a missing object answers 400 with a NoSuchKey body here,
    // not the 404 the docs imply, and HEAD has no body to disambiguate. Treated
    // as "not found", but warned because a misconfigured bucket or revoked key
    // produces the same status and would otherwise read as routine misses.
    if (res.status === 400) {
      this.logger.warn({ path, status: res.status }, 'Storage returned 400 while stat-ing an object');
      return null;
    }
    if (!res.ok) throw new Error(`Storage refused to stat an object: ${res.status}`);

    return {
      size: Number(res.headers.get('content-length') ?? 0),
      contentType: res.headers.get('content-type') ?? '',
    };
  }

  /**
   * For bytes the API produced itself: a certificate PDF is rendered
   * server-side and must never be something a browser can put there.
   * `x-upsert` so a reissue replaces the object at the same deterministic path.
   */
  async putObject(
    path: string,
    body: Buffer,
    contentType: string,
    bucket: string = STORAGE_BUCKET,
  ): Promise<void> {
    const res = await fetch(`${this.baseUrl}/storage/v1/object/${bucket}/${path}`, {
      method: 'POST',
      headers: { ...this.headers(), 'content-type': contentType, 'x-upsert': 'true' },
      body: new Uint8Array(body),
    });

    // Only the status: the body may echo the service role key back.
    if (!res.ok) throw new Error(`Storage refused an upload: ${res.status}`);
  }

  /** For objects that are genuinely public: club logos, banners, posters. */
  publicUrlFor(path: string, version: number): string {
    return publicUrl(this.baseUrl, path, version);
  }
}
