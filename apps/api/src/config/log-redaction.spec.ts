import pino from 'pino';
import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { LOG_REDACT_PATHS } from './log-redaction';

describe('LOG_REDACT_PATHS', () => {
  it('covers every path a secret is known to travel', () => {
    // Pinned explicitly: silently dropping a path is exactly the regression
    // this guards against, and a laxer assertion would not notice.
    expect([...LOG_REDACT_PATHS]).toEqual([
      'req.headers.cookie',
      'req.headers.authorization',
      'req.body.password',
      'req.body.token',
      'res.headers["set-cookie"]',
    ]);
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

    logger.info(
      {
        req: {
          headers: {
            cookie: 'majlis_session=LEAKED',
            authorization: 'Bearer LEAKED',
          },
          body: { password: 'LEAKED', token: 'LEAKED' },
        },
        res: { headers: { 'set-cookie': 'majlis_session=LEAKED' } },
      },
      'request completed',
    );

    const output = lines.join('');
    expect(output).toContain('request completed');
    expect(output).not.toContain('LEAKED');
  });
});
