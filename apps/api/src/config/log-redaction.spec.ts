import pino from 'pino';
import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { LOG_REDACT_PATHS, redactedReqSerializer } from './log-redaction';
import { envSchema } from './env.schema';
import { SWEEP_SECRET_HEADER } from './sweep-header';

describe('LOG_REDACT_PATHS', () => {
  it('covers every path a secret is known to travel', () => {
    // Pinned explicitly: silently dropping a path is exactly the regression
    // this guards against, and a laxer assertion would not notice.
    expect([...LOG_REDACT_PATHS]).toEqual([
      'req.headers.cookie',
      'req.headers.authorization',
      'req.query.token',
      'req.query.code',
      'req.query.pass',
      'res.headers["set-cookie"]',
      '*.headers.cookie',
      '*.headers.authorization',
      'req.headers["x-lifecycle-sweep-secret"]',
      '*.headers["x-lifecycle-sweep-secret"]',
    ]);
  });

  it('strips the sweep secret from a request log line', () => {
    // Spec 11 lists the sweep secret with session secrets and signing keys as
    // something that never reaches a log. autoLogging serializes the whole
    // headers object, so before these paths existed every call to the sweep
    // endpoint, failed guesses included, logged it verbatim.
    const lines: string[] = [];
    const sink = new Writable({
      write(chunk, _encoding, done) {
        lines.push(String(chunk));
        done();
      },
    });

    const logger = pino({ redact: { paths: [...LOG_REDACT_PATHS], remove: true } }, sink);
    logger.info({
      req: { headers: { [SWEEP_SECRET_HEADER]: 'SUPERSECRETVALUE' } },
      err: { headers: { [SWEEP_SECRET_HEADER]: 'SUPERSECRETVALUE' } },
    });

    expect(lines.join('')).not.toContain('SUPERSECRETVALUE');
  });

  it('actually strips those values from an emitted log line', () => {
    const lines: string[] = [];
    const sink = new Writable({
      write(chunk, _encoding, done) {
        lines.push(String(chunk));
        done();
      },
    });

    const logger = pino({ redact: { paths: [...LOG_REDACT_PATHS], remove: true } }, sink);

    // Shaped like pino-http's actual request serializer output:
    // { id, method, url, query, params, headers, remoteAddress, remotePort }
    // — notably no `body`. See pino-std-serializers/lib/req.js.
    logger.info(
      {
        req: {
          headers: {
            cookie: 'majlis_session=LEAKED',
            authorization: 'Bearer LEAKED',
          },
          query: { token: 'LEAKED', code: 'LEAKED' },
        },
        res: { headers: { 'set-cookie': 'majlis_session=LEAKED' } },
      },
      'request completed',
    );

    const output = lines.join('');
    expect(output).toContain('request completed');
    expect(output).not.toContain('LEAKED');
  });

  it('strips a nested err.headers.cookie, not only req/res', () => {
    // Catches redact paths rooted only at req.*/res.*: ProblemExceptionFilter
    // logs `{ err }` on 5xx, and an error carrying an attached request (e.g.
    // an http client error) would otherwise serialize its headers unredacted.
    const lines: string[] = [];
    const sink = new Writable({
      write(chunk, _encoding, done) {
        lines.push(String(chunk));
        done();
      },
    });

    const logger = pino({ redact: { paths: [...LOG_REDACT_PATHS], remove: true } }, sink);

    logger.error(
      { err: { headers: { cookie: 'majlis_session=LEAKED', authorization: 'Bearer LEAKED' } } },
      'Unhandled exception',
    );

    const output = lines.join('');
    expect(output).toContain('Unhandled exception');
    expect(output).not.toContain('LEAKED');
  });
});

describe('redactedReqSerializer', () => {
  it('drops the query string from the logged URL', () => {
    // Catches pino's default req serializer, which logs req.url verbatim.
    // Path-based redaction cannot strip a substring of a string value, so a
    // secret in a query parameter is redacted out of req.query and still
    // sits in req.url in the same log line.
    const out = redactedReqSerializer({
      id: 'r1',
      method: 'GET',
      url: '/api/v1/clubs?token=super-secret&limit=20',
      headers: {},
      query: {},
      params: {},
    } as never);

    expect(out.url).toBe('/api/v1/clubs');
    expect(JSON.stringify(out)).not.toContain('super-secret');
  });

  it('leaves a URL with no query string untouched', () => {
    const out = redactedReqSerializer({
      id: 'r1',
      method: 'GET',
      url: '/api/v1/health',
      headers: {},
      query: {},
      params: {},
    } as never);

    expect(out.url).toBe('/api/v1/health');
  });
});

describe('the QR pass token and its signing key', () => {
  it('serializes no request body at all, which is where the pass token travels', () => {
    // The whole redaction story for the pass rests on this: the token is
    // posted in a body, and pino-http's request serializer produces
    // { id, method, url, query, params, headers, remoteAddress, remotePort }
    // and no `body` key for a path-based redaction to need to strip.
    //
    // Catches a serializer that starts passing the body through — the one
    // change that would put a live credential into every scan's log line,
    // with no redaction path covering it, silently.
    const out = redactedReqSerializer({
      id: 'r1',
      method: 'POST',
      url: '/api/v1/events/e1/check-in/scan',
      headers: {},
      query: {},
      params: {},
      body: { token: 'v1.LEAKEDPAYLOAD.LEAKEDSIGNATURE' },
    } as never);

    expect(out).not.toHaveProperty('body');
    expect(JSON.stringify(out)).not.toContain('LEAKED');
  });

  it('keeps the signing secret out of every line a boot can emit', () => {
    // Spec 11: the QR signing key never appears in a log. The one line a
    // boot emits that has ever seen it is the environment validation
    // failure NestFactory logs when the process refuses to start, so that
    // error must carry the rule that was broken and never the value that
    // broke it.
    //
    // The secret below is 16 characters, so it is the field that FAILS
    // min(32) and the one Zod is reporting on. A 32-character value passes
    // that rule, Zod raises no issue for the field at all, and the
    // assertions underneath would hold against a schema that interpolated
    // every offending value into its messages.
    const failed = envSchema.safeParse({
      DATABASE_URL: 'postgresql://u:p@localhost:5432/d',
      SESSION_SECRET: 'too-short',
      SUPABASE_STORAGE_URL: 'https://example.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'x'.repeat(40),
      QR_SIGNING_SECRET: 'SUPERSECRETVALUE',
    });

    // The failure is about QR_SIGNING_SECRET, not only about the other
    // fields: an issue list that never mentions it proves nothing below.
    expect(failed.success).toBe(false);
    expect(failed.error?.issues.some((i) => i.path[0] === 'QR_SIGNING_SECRET')).toBe(true);
    expect(String(failed.error)).not.toContain('SUPERSECRETVALUE');
    expect(JSON.stringify(failed.error)).not.toContain('SUPERSECRETVALUE');

    // And, for the day a deep link or a prefetched image moves the token
    // into a query string: req.query.pass is stripped from the emitted line.
    const lines: string[] = [];
    const sink = new Writable({
      write(chunk, _encoding, done) {
        lines.push(String(chunk));
        done();
      },
    });
    const logger = pino({ redact: { paths: [...LOG_REDACT_PATHS], remove: true } }, sink);
    logger.info({ req: { query: { pass: 'v1.SUPERSECRETVALUE.SUPERSECRETVALUE' } } }, 'scan');

    expect(lines.join('')).toContain('scan');
    expect(lines.join('')).not.toContain('SUPERSECRETVALUE');
  });
});
