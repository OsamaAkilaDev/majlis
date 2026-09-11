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

  it('exposes nothing sensitive — no connection string, no secret', async () => {
    const res = await request(app.getHttpServer()).get(`${API_PREFIX}/health`).expect(200);
    const body = JSON.stringify(res.body);
    expect(body).not.toMatch(/postgres/i);
    expect(body).not.toMatch(/password/i);
    expect(Object.keys(res.body).sort()).toEqual(['database', 'status', 'uptimeSeconds']);
  });

  it('is served under the api/v1 prefix, not at the root', async () => {
    // Before this suite used configureApp, this app instance registered only
    // setGlobalPrefix, so this assertion checked nothing but the bare status
    // code. The assumption going in was that fully bootstrapping the app
    // (Nest's own global prefix + exception filter, exactly as main.ts runs
    // it) would turn this into Problem Details, matching the rest of the
    // API's error contract.
    //
    // That assumption does not hold, and this is a real, separate finding,
    // not just a stale comment: a path outside the global prefix entirely
    // (no "/api/v1") never reaches Nest's routing or exception-filter
    // pipeline at all — Express's own bare fallback handler answers first,
    // with "Cannot GET /health" as HTML. This is unrelated to whether
    // ZodValidationPipe/ProblemExceptionFilter are registered; it reproduces
    // identically with or without configureApp, because the request never
    // enters Nest's machinery in the first place. Only unmatched paths
    // *inside* the prefix (see problem.integration.test.ts's `${API_PREFIX}/nope`)
    // go through the filter and come back as Problem Details.
    const res = await request(app.getHttpServer()).get('/health').expect(404);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.text).toContain('Cannot GET /health');
  });
});
