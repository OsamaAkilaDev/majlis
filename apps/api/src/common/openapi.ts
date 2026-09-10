import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { cleanupOpenApiDoc } from 'nestjs-zod';

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
  SwaggerModule.setup('api/v1/docs', app, document);
}
