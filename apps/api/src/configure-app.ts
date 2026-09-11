import type { INestApplication } from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import { ZodValidationPipe } from 'nestjs-zod';
import { setupOpenApi } from './common/openapi';
import { ProblemExceptionFilter } from './common/problem/problem.filter';
import { API_PREFIX } from './config/api-prefix';

/**
 * Everything that turns a bare Nest application into the Majlis API.
 *
 * This exists so the integration tests exercise the SAME bootstrap the
 * server runs, rather than an approximation of it. Three separate
 * hand-rolled versions had already drifted apart before this was extracted.
 */
export function configureApp(app: INestApplication): void {
  const logger = app.get(Logger);

  app.useLogger(logger);
  // See api-prefix.ts for why this must keep its leading slash.
  app.setGlobalPrefix(API_PREFIX);
  app.useGlobalPipes(new ZodValidationPipe());
  app.useGlobalFilters(new ProblemExceptionFilter(logger));
  app.enableShutdownHooks();

  setupOpenApi(app);
}
