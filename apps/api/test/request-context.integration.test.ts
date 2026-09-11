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

/**
 * Interceptors are consulted per-request by Nest's own execution pipeline
 * (not statically compiled into Express's middleware array like app.use()
 * is), so registering this global interceptor lets the test observe
 * RequestContext.current from inside a real request without adding a
 * controller just for the test. It must be registered before app.init(),
 * same as the global interceptors any real feature module would add via
 * APP_INTERCEPTOR — one registered afterwards is silently never consulted.
 */
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
    // Catches: a request-context middleware that reads req.id assuming
    // nestjs-pino's genReqId already ran. It hasn't — nestjs-pino binds its
    // middleware via NestModule.configure(), which Nest defers to
    // app.init(), strictly after configureApp()'s direct app.use() calls
    // (verified by running the real bootstrap: with that ordering, req.id
    // was undefined here and the context silently fell back to 'unknown'
    // on every request). This middleware must assign the id itself instead.
    const res = await request(app.getHttpServer()).get(`${API_PREFIX}/health`).expect(200);

    expect(seenRequestId).toBeDefined();
    expect(seenRequestId).not.toBe('unknown');
    expect(seenRequestId).toBe(res.headers['x-request-id']);
  });

  it('reuses a caller-supplied x-request-id rather than minting a fresh one', async () => {
    // Catches an implementation that always calls randomUUID(), ignoring an
    // incoming x-request-id header — the pre-existing problem.filter.ts
    // contract callers rely on to correlate their own logs.
    await request(app.getHttpServer())
      .get(`${API_PREFIX}/health`)
      .set('x-request-id', 'trace-me-456')
      .expect(200);

    expect(seenRequestId).toBe('trace-me-456');
  });

  it('treats a blank x-request-id header as absent rather than adopting it verbatim', async () => {
    // Catches a `typeof v === 'string'` check with no blank check: it would
    // satisfy audit_log.request_id's NOT NULL constraint while writing an
    // empty string into every audit row for the request — useless for
    // correlating anything, and not caught by the "not 'unknown'" assertion
    // above.
    const res = await request(app.getHttpServer())
      .get(`${API_PREFIX}/health`)
      .set('x-request-id', '')
      .expect(200);

    expect(seenRequestId).toBeTruthy();
    expect(seenRequestId).toBe(res.headers['x-request-id']);
  });
});
