import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';

let app: INestApplication;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api/v1');
  await app.init();
});

afterAll(async () => {
  await app?.close();
});

describe('GET /api/v1/health', () => {
  it('reports ok with the database up', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/health').expect(200);
    expect(res.body).toMatchObject({ status: 'ok', database: 'up' });
    expect(typeof res.body.uptimeSeconds).toBe('number');
  });

  it('exposes nothing sensitive — no connection string, no secret', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/health').expect(200);
    const body = JSON.stringify(res.body);
    expect(body).not.toMatch(/postgres/i);
    expect(body).not.toMatch(/password/i);
    expect(Object.keys(res.body).sort()).toEqual(['database', 'status', 'uptimeSeconds']);
  });

  it('is served under the api/v1 prefix, not at the root', async () => {
    await request(app.getHttpServer()).get('/health').expect(404);
  });
});
