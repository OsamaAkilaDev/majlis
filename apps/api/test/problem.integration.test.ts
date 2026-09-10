import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Logger } from 'nestjs-pino';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { ProblemExceptionFilter } from '../src/common/problem/problem.filter';
import { API_PREFIX } from '../src/config/api-prefix';

let app: INestApplication;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  // See api-prefix.ts for why this must keep its leading slash.
  app.setGlobalPrefix(API_PREFIX);
  app.useGlobalFilters(new ProblemExceptionFilter(app.get(Logger)));
  await app.init();
});

afterAll(async () => {
  await app?.close();
});

describe('error responses', () => {
  it('returns problem+json for an unknown route', async () => {
    const res = await request(app.getHttpServer()).get(`${API_PREFIX}/nope`).expect(404);
    expect(res.headers['content-type']).toMatch(/application\/problem\+json/);
    expect(res.body).toMatchObject({ status: 404, title: expect.any(String) });
    expect(res.body.instance).toBe(`${API_PREFIX}/nope`);
  });

  it('always carries a request id the user can quote', async () => {
    const res = await request(app.getHttpServer()).get(`${API_PREFIX}/nope`).expect(404);
    expect(res.body.requestId).toEqual(expect.any(String));
    expect(res.body.requestId.length).toBeGreaterThan(0);
  });

  it('echoes a caller-supplied x-request-id so logs correlate end to end', async () => {
    const res = await request(app.getHttpServer())
      .get(`${API_PREFIX}/nope`)
      .set('x-request-id', 'trace-me-123')
      .expect(404);
    expect(res.body.requestId).toBe('trace-me-123');
  });
});
