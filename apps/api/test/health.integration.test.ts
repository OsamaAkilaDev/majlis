import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API_PREFIX } from '../src/config/api-prefix';
import { createTestApp } from './app';

let app: INestApplication;

beforeAll(async () => {
  app = await createTestApp();
});

afterAll(async () => {
  await app?.close();
});

describe(`GET ${API_PREFIX}/health`, () => {
  it('reports ok with the database up', async () => {
    const res = await request(app.getHttpServer()).get(`${API_PREFIX}/health`).expect(200);
    expect(res.body).toMatchObject({ status: 'ok', database: 'up' });
    expect(typeof res.body.uptimeSeconds).toBe('number');
  });

  it('exposes nothing sensitive: no connection string, no secret', async () => {
    const res = await request(app.getHttpServer()).get(`${API_PREFIX}/health`).expect(200);
    const body = JSON.stringify(res.body);
    expect(body).not.toMatch(/postgres/i);
    expect(body).not.toMatch(/password/i);
    expect(Object.keys(res.body).sort()).toEqual(['database', 'status', 'uptimeSeconds']);
  });

  it('is served under the api/v1 prefix, not at the root', async () => {
    // HTML, not Problem Details: a path outside the global prefix never reaches
    // Nest's routing or filters at all, because Express's bare fallback answers
    // first. Only unmatched paths INSIDE the prefix go through the filter.
    const res = await request(app.getHttpServer()).get('/health').expect(404);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.text).toContain('Cannot GET /health');
  });
});
