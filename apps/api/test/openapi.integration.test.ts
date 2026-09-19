import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API_PREFIX } from '../src/config/api-prefix';
import { createTestApp } from './app';

let app: INestApplication;

beforeAll(async () => { app = await createTestApp(); });
afterAll(async () => { await app.close(); });

interface OpenApiSchema {
  $ref?: string;
  properties?: Record<string, unknown>;
}

interface OpenApiOperation {
  responses?: Record<string, { content?: Record<string, { schema: OpenApiSchema }> }>;
}

interface OpenApiDoc {
  openapi: string;
  paths: Record<string, Record<string, OpenApiOperation>>;
  components?: { schemas?: Record<string, OpenApiSchema> };
}

/**
 * Resolves a `{ $ref: '#/components/schemas/X' }` node against the document
 * it came from: `content['application/json'].schema` is always this shape
 * for a DTO-typed `@ApiResponse`, never the inline schema itself.
 */
function resolveSchema(doc: OpenApiDoc, schema: OpenApiSchema): OpenApiSchema {
  if (!schema.$ref) return schema;
  const name = schema.$ref.replace('#/components/schemas/', '');
  const resolved = doc.components?.schemas?.[name];
  if (!resolved) throw new Error(`Document has no component schema named ${name}`);
  return resolved;
}

function fetchDoc(): Promise<request.Response> {
  return request(app.getHttpServer()).get(`${API_PREFIX}/docs-json`);
}

describe('generated OpenAPI document', () => {
  it('is reachable at docs-json with no session cookie: Swagger mounts outside the Nest router, same as /docs (Task 7)', async () => {
    const res = await fetchDoc();
    expect(res.status).toBe(200);
    expect((res.body as OpenApiDoc).openapi).toMatch(/^3\./);
  });

  it("declares POST /auth/login's 401 response with a real Problem Details schema", async () => {
    const res = await fetchDoc();
    const doc = res.body as OpenApiDoc;

    const loginPath = Object.keys(doc.paths).find((p) => p.endsWith('/auth/login'));
    expect(loginPath).toBeDefined();

    const response401 = doc.paths[loginPath!]!.post?.responses?.['401'];
    // Catches a route that documents no error responses at all, the state
    // before this task, where the Problem Details schemas were imported only
    // as TYPES and so never reached the generated document.
    expect(response401).toBeDefined();

    const schema = resolveSchema(doc, response401!.content!['application/json']!.schema);

    // The bug being fixed produces a document with no error SHAPE: a test
    // that stopped at "the 401 key exists" would still pass against a
    // response object carrying an empty or missing schema. Asserting the
    // resolved schema's own properties is what actually discriminates: it
    // fails unless a real Problem Details shape reached components.schemas,
    // not just a response status code.
    expect(schema.properties).toBeDefined();
    expect(schema.properties!.type).toBeDefined();
    expect(schema.properties!.title).toBeDefined();
    expect(schema.properties!.status).toBeDefined();
  });

  it("declares PATCH /users/{id}/status's 404 response with the same Problem Details schema component", async () => {
    // A second route, reusing the same component, proves the schema is
    // registered once and referenced (per openapi.ts's design), not
    // hand-written per route as the spec forbids.
    const res = await fetchDoc();
    const doc = res.body as OpenApiDoc;

    const statusPath = Object.keys(doc.paths).find((p) => p.endsWith('/status') && p.includes('/users/'));
    expect(statusPath).toBeDefined();

    const response404 = doc.paths[statusPath!]!.patch?.responses?.['404'];
    expect(response404).toBeDefined();

    const loginPath = Object.keys(doc.paths).find((p) => p.endsWith('/auth/login'))!;
    const loginSchemaRef = doc.paths[loginPath]!.post!.responses!['401']!.content!['application/json']!.schema.$ref;
    const statusSchemaRef = response404!.content!['application/json']!.schema.$ref;
    expect(statusSchemaRef).toBe(loginSchemaRef);
  });
});

describe('403 responses follow @RequirePermission', () => {
  /**
   * The decorator emits its own `@ApiResponse(403)` rather than leaving it to
   * be hand-written beside all 41 call sites, which is how the document and
   * the guard drift apart. These two cases are what make that a fold rather
   * than a blanket: one guarded route must carry the 403, one deliberately
   * unguarded route must not.
   */
  it('documents 403 on a guarded route, with the Problem Details schema', async () => {
    const doc = (await fetchDoc()).body as OpenApiDoc;

    const auditPath = Object.keys(doc.paths).find((p) => p.endsWith('/audit'));
    expect(auditPath).toBeDefined();

    const response403 = doc.paths[auditPath!]!.get?.responses?.['403'];
    expect(response403).toBeDefined();

    // Not just the status key: a response carrying no schema would still
    // satisfy "the 403 exists" while documenting nothing about its body.
    const schema = resolveSchema(doc, response403!.content!['application/json']!.schema);
    expect(schema.properties?.title).toBeDefined();
    expect(schema.properties?.status).toBeDefined();
  });

  it('leaves a self-scoped route without one', async () => {
    const doc = (await fetchDoc()).body as OpenApiDoc;

    // GET /me/invitations carries no @RequirePermission: it is scoped by
    // `actor.id` inside TeamService. A 403 here would mean the decorator's
    // response had been applied globally instead of per call site.
    const invitationsPath = Object.keys(doc.paths).find((p) => p.endsWith('/me/invitations'));
    expect(invitationsPath).toBeDefined();
    expect(doc.paths[invitationsPath!]!.get?.responses?.['403']).toBeUndefined();
  });
});
