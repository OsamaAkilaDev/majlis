import type { CallHandler, ExecutionContext, INestApplication, NestInterceptor } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { RequestContext } from '../src/common/request-context';
import { configureApp } from '../src/configure-app';
import { API_PREFIX } from '../src/config/api-prefix';

let app: INestApplication;
let seenRequestId: string | undefined;

/** A global interceptor lets the test observe RequestContext.current inside a
 * real request without adding a controller. It must be registered before
 * app.init(): one registered afterwards is silently never consulted. */
class CaptureRequestIdInterceptor implements NestInterceptor {
  constructor(private readonly context: RequestContext) {}

  intercept(_ctx: ExecutionContext, next: CallHandler) {
    seenRequestId = this.context.current?.requestId;
    return next.handle();
  }
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  configureApp(app);
  app.useGlobalInterceptors(new CaptureRequestIdInterceptor(app.get(RequestContext)));
  await app.init();
});

afterAll(async () => {
  await app?.close();
});

describe('request context wiring in the real bootstrap', () => {
  it('carries the same request id echoed in the x-request-id response header', async () => {
    // Catches middleware reading req.id and assuming nestjs-pino's genReqId ran.
    // It has not: pino binds via NestModule.configure(), deferred to app.init(),
    // after configureApp()'s app.use() calls, so req.id is undefined and the
    // context falls back to 'unknown'. This middleware assigns the id itself.
    const res = await request(app.getHttpServer()).get(`${API_PREFIX}/health`).expect(200);

    expect(seenRequestId).toBeDefined();
    expect(seenRequestId).not.toBe('unknown');
    expect(seenRequestId).toBe(res.headers['x-request-id']);
  });

  it('reuses a caller-supplied x-request-id rather than minting a fresh one', async () => {
    // Catches an implementation always calling randomUUID() and ignoring an
    // incoming x-request-id, which callers rely on to correlate their logs.
    await request(app.getHttpServer())
      .get(`${API_PREFIX}/health`)
      .set('x-request-id', 'trace-me-456')
      .expect(200);

    expect(seenRequestId).toBe('trace-me-456');
  });

  it('treats a blank x-request-id header as absent rather than adopting it verbatim', async () => {
    // Catches a `typeof v === 'string'` check with no blank check: it satisfies
    // audit_log.request_id's NOT NULL while writing an empty string into every
    // audit row, and the "not 'unknown'" assertion above misses it.
    const res = await request(app.getHttpServer())
      .get(`${API_PREFIX}/health`)
      .set('x-request-id', '')
      .expect(200);

    expect(seenRequestId).toBeTruthy();
    expect(seenRequestId).toBe(res.headers['x-request-id']);
  });
});
