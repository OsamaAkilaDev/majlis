import { ConfigService } from '@nestjs/config';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StorageService } from './storage.service';

const KEY = 'service-role-key-value';

function serviceWith(fetchImpl: typeof fetch) {
  const config = new ConfigService({
    SUPABASE_STORAGE_URL: 'https://example.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: KEY,
  });
  const logger = { warn: vi.fn(), error: vi.fn() };
  vi.stubGlobal('fetch', fetchImpl);
  return { svc: new StorageService(config as never, logger as never), logger };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('createSignedUploadUrl', () => {
  it('authenticates with the service role key and returns an absolute URL', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const { svc } = serviceWith((async (url: string, init: RequestInit) => {
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
    // The mocked body carries a plausible `url` alongside the error. Without
    // that, this test could not fail: `body.url` would already be undefined,
    // so removing the `res.ok` check entirely would still hit the unrelated
    // "no signed URL" throw and pass anyway. With a url present, only the
    // status check stops a 401 from producing a bogus signed URL, and the
    // assertion below matches only that throw site's message, not both.
    const { svc } = serviceWith((async () =>
      new Response(
        JSON.stringify({
          error: 'Unauthorized',
          url: '/object/upload/sign/majlis-storage/clubs/a/logo.webp?token=bogus',
        }),
        { status: 401 },
      )) as unknown as typeof fetch);

    await expect(svc.createSignedUploadUrl('clubs/a/logo.webp')).rejects.toThrow(
      /refused to sign an upload url: 401/i,
    );
  });
});

describe('statObject', () => {
  it('returns null for a 404, the documented not-found status, without warning', async () => {
    const { svc, logger } = serviceWith((async () => new Response(null, { status: 404 })) as unknown as typeof fetch);
    expect(await svc.statObject('clubs/a/logo.webp')).toBeNull();
    // 404 is the unambiguous, expected case (no upload yet). Warning on it
    // would drown out the 400 branch's warning, below, which is the one that
    // actually needs attention.
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('returns null for a 400 too, and warns since that status is not unambiguous', async () => {
    // Verified against the live Supabase project (task-2-report.md, Step 1):
    // a missing object answers HTTP 400 with a NoSuchKey body, not the 404
    // the Storage API docs' happy path implies. Catches an implementation
    // written from the docs alone, which would throw here instead of
    // returning null, and every caller checking for a missing upload would
    // see a 500 instead of "not uploaded yet".
    const { svc, logger } = serviceWith((async () => new Response(null, { status: 400 })) as unknown as typeof fetch);
    expect(await svc.statObject('clubs/a/logo.webp')).toBeNull();
    // A 400 can also mean a misconfigured bucket or a revoked key, and HEAD
    // carries no body to tell the two apart from here. Catches the log call
    // being dropped silently, which would hide a systemic failure behind a
    // string of "not uploaded yet" results.
    expect(logger.warn).toHaveBeenCalledTimes(1);
    const [payload] = logger.warn.mock.calls[0] as [Record<string, unknown>, string];
    expect(payload).toEqual({ path: 'clubs/a/logo.webp', status: 400 });
    expect(payload).not.toHaveProperty('key');
  });

  it('reports the size and content type of an object that does exist', async () => {
    const { svc } = serviceWith((async () =>
      new Response(null, {
        status: 200,
        headers: { 'content-length': '1234', 'content-type': 'image/webp' },
      })) as unknown as typeof fetch);

    expect(await svc.statObject('clubs/a/logo.webp')).toEqual({ size: 1234, contentType: 'image/webp' });
  });

  it('treats a missing content-length as size zero rather than NaN', async () => {
    // Headers.get() returns null (never undefined) for an absent header, and
    // Number(null) is 0 already. This locks in that zero, not a parse of some
    // other fallback, is what a caller's `size > cap` comparison sees for an
    // object with no reported length.
    const { svc } = serviceWith((async () =>
      new Response(null, { status: 200, headers: { 'content-type': 'image/webp' } })) as unknown as typeof fetch);

    expect(await svc.statObject('clubs/a/logo.webp')).toEqual({ size: 0, contentType: 'image/webp' });
  });
});
