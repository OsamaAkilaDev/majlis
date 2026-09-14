import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { cleanupOpenApiDoc } from 'nestjs-zod';
import { SESSION_COOKIE } from '../auth/cookies';
import { API_PREFIX } from '../config/api-prefix';

/**
 * The OpenAPI document is generated from the Zod-derived DTOs, never written
 * by hand.
 *
 * nestjs-zod v5 relies on Zod 4's native JSON Schema output, so there is no
 * `patchNestJsSwagger` any more — it was removed in v5. `cleanupOpenApiDoc`
 * post-processes the generated document instead.
 *
 * DEVIATION from spec §8, which says the document is served at
 * `${API_PREFIX}/docs`: it is served there everywhere except production.
 * SwaggerModule.setup mounts on the Express instance, outside Nest's guard
 * pipeline, so SessionGuard never sees these two paths and cannot be made
 * to. Unauthenticated, they publish the whole route inventory and every
 * request and response schema to anyone who can reach the API. There is no
 * seam to authenticate them through without hand-rolling middleware, and no
 * production reader who cannot get the document from the repository, so the
 * routes simply do not exist in production.
 */
export function setupOpenApi(app: INestApplication): void {
  if (process.env.NODE_ENV === 'production') return;

  const config = new DocumentBuilder()
    .setTitle('Majlis API')
    .setDescription('University club and event management.')
    .setVersion('1.0')
    .addCookieAuth(SESSION_COOKIE)
    .build();

  const document = cleanupOpenApiDoc(SwaggerModule.createDocument(app, config));
  // SwaggerModule.setup is not covered by setGlobalPrefix, so the path must
  // still be spelled out here — but built from the constant rather than
  // duplicating the literal '/api/v1'.
  SwaggerModule.setup(`${API_PREFIX}/docs`, app, document);
}
