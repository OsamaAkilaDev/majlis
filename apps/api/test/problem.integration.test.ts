import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Logger } from 'nestjs-pino';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { ProblemExceptionFilter } from '../src/common/problem/problem.filter';

let app: INestApplication;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  // Leading slash required — see the comment in src/main.ts on
  // setGlobalPrefix for why 'api/v1' (no slash) breaks the 404 path.
  app.setGlobalPrefix('/api/v1');
  app.useGlobalFilters(new ProblemExceptionFilter(app.get(Logger)));
  await app.init();
});

afterAll(async () => {
  await app?.close();
});

describe('error responses', () => {
  it('returns problem+json for an unknown route', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/nope').expect(404);
    expect(res.headers['content-type']).toMatch(/application\/problem\+json/);
    expect(res.body).toMatchObject({ status: 404, title: expect.any(String) });
    expect(res.body.instance).toBe('/api/v1/nope');
  });

  it('always carries a request id the user can quote', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/nope').expect(404);
    expect(res.body.requestId).toEqual(expect.any(String));
    expect(res.body.requestId.length).toBeGreaterThan(0);
  });

  it('echoes a caller-supplied x-request-id so logs correlate end to end', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/nope')
      .set('x-request-id', 'trace-me-123')
      .expect(404);
    expect(res.body.requestId).toBe('trace-me-123');
  });
});
