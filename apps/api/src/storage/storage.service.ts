import { Injectable } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- value import: Nest DI resolves this from design:paramtypes.
import { ConfigService } from '@nestjs/config';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- value import: see above.
import { Logger } from 'nestjs-pino';
import type { Env } from '../config/env.schema';
import { STORAGE_BUCKET, publicUrl } from './image-kinds';

/**
 * Two calls against Supabase's Storage REST API. Deliberately not the
 * @supabase/supabase-js SDK, which carries auth, realtime and postgrest
 * clients for what is two HTTP requests.
 *
 * The service role key bypasses row level security entirely. It is read here
 * and nowhere else, never returned in a response, and never logged.
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

  /**
   * A one-use, path-scoped upload URL. The path is built server-side from an
   * id the request was already authorized against, so the browser cannot
   * choose where its bytes land.
   */
  async createSignedUploadUrl(path: string): Promise<{ signedUrl: string; token: string }> {
    const res = await fetch(`${this.baseUrl}/storage/v1/object/upload/sign/${STORAGE_BUCKET}/${path}`, {
      method: 'POST',
      headers: this.headers(),
    });

    if (!res.ok) {
      // The body may carry the key back in an error echo. Only the status
      // is reported.
      throw new Error(`Storage refused to sign an upload URL: ${res.status}`);
    }

    const body = (await res.json()) as { url?: string };
    if (!body.url) throw new Error('Storage returned no signed URL.');

    // Verified live (task-2-report.md): `url` is relative to /storage/v1,
    // e.g. "/object/upload/sign/<bucket>/<path>?token=...".
    const signedUrl = body.url.startsWith('http') ? body.url : `${this.baseUrl}/storage/v1${body.url}`;
    const token = new URL(signedUrl).searchParams.get('token') ?? '';
    return { signedUrl, token };
  }

  /**
   * Size and content type of an uploaded object, or null if it is not there.
   * This is what lets a handler refuse to store a URL for an upload that
   * never happened, which matters because the API never sees the bytes.
   */
  async statObject(path: string): Promise<{ size: number; contentType: string } | null> {
    const res = await fetch(`${this.baseUrl}/storage/v1/object/public/${STORAGE_BUCKET}/${path}`, {
      method: 'HEAD',
    });
    if (res.status === 404) return null;
    // Verified live (task-2-report.md): a missing object answers 400 with a
    // NoSuchKey body on this project, not the 404 the docs' happy path
    // implies. HEAD has no body to disambiguate further, so this is also
    // treated as "not found" rather than a transport error, but unlike 404 it
    // is not unambiguous: a misconfigured bucket, public access turned off,
    // or a revoked key can also produce it. The warn line is how a systemic
    // cause gets noticed instead of silently reading as routine misses.
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

  publicUrlFor(path: string, version: number): string {
    return publicUrl(this.baseUrl, path, version);
  }
}
