import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { Logger } from 'nestjs-pino';
import { ZodValidationPipe } from 'nestjs-zod';
import { AppModule } from './app.module';
import { setupOpenApi } from './common/openapi';
import { ProblemExceptionFilter } from './common/problem/problem.filter';
import type { Env } from './config/env.schema';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const logger = app.get(Logger);

  app.useLogger(logger);
  // A leading slash is required: @nestjs/core's registerNotFoundHandler()
  // and registerExceptionHandler() pass the raw prefix straight to the
  // Express adapter's setNotFoundHandler/setErrorHandler without the
  // addLeadingSlash() normalization that registerRouter() applies to every
  // real route. A prefix of 'api/v1' (no leading slash) becomes an Express
  // mount path that never matches an incoming URL, so unmatched routes and
  // adapter-level errors fall straight through to Express's raw default
  // handler — bypassing this filter entirely. See the 404 assertions in
  // test/problem.integration.test.ts.
  app.setGlobalPrefix('/api/v1');
  app.useGlobalPipes(new ZodValidationPipe());
  app.useGlobalFilters(new ProblemExceptionFilter(logger));
  app.enableShutdownHooks();

  setupOpenApi(app);

  const config = app.get(ConfigService<Env, true>);
  await app.listen(config.get('PORT', { infer: true }));
}

void bootstrap();
