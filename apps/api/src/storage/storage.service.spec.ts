import { ConfigService } from '@nestjs/config';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StorageService } from './storage.service';

const KEY = 'service-role-key-value';

function serviceWith(fetchImpl: typeof fetch): StorageService {
  const config = new ConfigService({
    SUPABASE_STORAGE_URL: 'https://example.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: KEY,
  });
  vi.stubGlobal('fetch', fetchImpl);
  return new StorageService(config as never);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('createSignedUploadUrl', () => {
  it('authenticates with the service role key and returns an absolute URL', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const svc = serviceWith((async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ url: '/object/upload/sign/majlis-storage/clubs/a/logo.webp?token=tok' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch);

    const out = await svc.createSignedUploadUrl('clubs/a/logo.webp');

    // Catches a relative URL returned straight through: the browser would
    // PUT to the web app's own origin and the upload would 404.
    expect(out.signedUrl.startsWith('https://example.supabase.co/storage/v1/')).toBe(true);
    expect(out.token).toBe('tok');
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe(`Bearer ${KEY}`);
  });

  it('throws rather than returning a broken URL when Supabase refuses', async () => {
    // Catches a client that ignores the status and parses the error body as
    // a success, handing the browser an unusable URL and storing a logoUrl
    // for an object that was never created.
    const svc = serviceWith((async () =>
      new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })) as unknown as typeof fetch);

    await expect(svc.createSignedUploadUrl('clubs/a/logo.webp')).rejects.toThrow(/storage/i);
  });
});

describe('statObject', () => {
  it('returns null for a 404, the documented not-found status', async () => {
    const svc = serviceWith((async () => new Response(null, { status: 404 })) as unknown as typeof fetch);
    expect(await svc.statObject('clubs/a/logo.webp')).toBeNull();
  });

  it('returns null for a 400 too, the status the live bucket actually returns for a missing key', async () => {
    // Verified against the live Supabase project (task-2-report.md, Step 1):
    // a missing object answers HTTP 400 with a NoSuchKey body, not the 404
    // the Storage API docs' happy path implies. Catches an implementation
    // written from the docs alone, which would throw here instead of
    // returning null, and every caller checking for a missing upload would
    // see a 500 instead of "not uploaded yet".
    const svc = serviceWith((async () => new Response(null, { status: 400 })) as unknown as typeof fetch);
    expect(await svc.statObject('clubs/a/logo.webp')).toBeNull();
  });

  it('reports the size and content type of an object that does exist', async () => {
    const svc = serviceWith((async () =>
      new Response(null, {
        status: 200,
        headers: { 'content-length': '1234', 'content-type': 'image/webp' },
      })) as unknown as typeof fetch);

    expect(await svc.statObject('clubs/a/logo.webp')).toEqual({ size: 1234, contentType: 'image/webp' });
  });

  it('treats a missing content-length as size zero rather than NaN', async () => {
    // Catches Number(null) reaching a `size > cap` comparison, which is
    // false for NaN, so an object of unknown size would pass verification.
    const svc = serviceWith((async () =>
      new Response(null, { status: 200, headers: { 'content-type': 'image/webp' } })) as unknown as typeof fetch);

    expect(await svc.statObject('clubs/a/logo.webp')).toEqual({ size: 0, contentType: 'image/webp' });
  });
});
