import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { cleanupOpenApiDoc } from 'nestjs-zod';
import { API_PREFIX } from '../config/api-prefix';

/**
 * The OpenAPI document is generated from the Zod-derived DTOs, never written
 * by hand.
 *
 * nestjs-zod v5 relies on Zod 4's native JSON Schema output, so there is no
 * `patchNestJsSwagger` any more — it was removed in v5. `cleanupOpenApiDoc`
 * post-processes the generated document instead.
 */
export function setupOpenApi(app: INestApplication): void {
  const config = new DocumentBuilder()
    .setTitle('Majlis API')
    .setDescription('University club and event management.')
    .setVersion('1.0')
    .addCookieAuth('majlis_session')
    .build();

  const document = cleanupOpenApiDoc(SwaggerModule.createDocument(app, config));
  // SwaggerModule.setup is not covered by setGlobalPrefix, so the path must
  // still be spelled out here — but built from the constant rather than
  // duplicating the literal '/api/v1'.
  SwaggerModule.setup(`${API_PREFIX}/docs`, app, document);
}
