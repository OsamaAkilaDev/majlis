import type { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import type { NextFunction, Request, Response } from 'express';
import { Logger } from 'nestjs-pino';
import { ZodValidationPipe } from 'nestjs-zod';
import { setupOpenApi } from './common/openapi';
import { ProblemExceptionFilter } from './common/problem/problem.filter';
import { RequestContext } from './common/request-context';
import { resolveRequestId } from './common/request-id';
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
  app.use(cookieParser());

  // Ambient per-request facts (requestId, ip, userAgent), read via
  // RequestContext.current anywhere downstream — Task 4's AuditService reads
  // it in the same transaction as the action it's recording. Registered with
  // app.use(), not consumer.apply(...).forRoutes('*'): Express 5 + path-to-
  // regexp 8 no longer accept a bare '*' route pattern, and app.use() does no
  // path matching at all, so the question doesn't arise. The provider is
  // resolved once, outside the per-request closure.
  //
  // This middleware assigns req.id itself, rather than reading a value
  // nestjs-pino's genReqId already set. Verified by running the real
  // bootstrap: direct app.use() calls (this one, cookieParser) land on
  // Express's middleware stack immediately, but nestjs-pino's own middleware
  // is bound via NestModule.configure(), which Nest defers to app.init() —
  // called strictly after configureApp() returns, in main.ts and in every
  // integration test's setup alike. So a middleware added here always runs
  // BEFORE pino-http, however it's ordered relative to cookieParser in this
  // file; req.id would still be undefined at this point. Assigning it here
  // instead — and letting pino-http adopt the value already on the request
  // (its own logic is `req.id = req.id || genReqId(req, res)`) — is what
  // actually makes a log line and an audit row for one request share an id.
  //
  // app.module.ts's LoggerModule config keeps its own genReqId as a
  // defensive fallback for a bootstrap entry point that never calls
  // configureApp() — deliberately redundant with this, not dead: pino-http's
  // `req.id || genReqId(...)` makes the fallback completely inert whenever
  // this middleware has already run, but req.id still ends up populated (and
  // RequestContext's absence is the only gap) if it hasn't.
  const requestContext = app.get(RequestContext);
  app.use((req: Request, res: Response, next: NextFunction) => {
    const requestId = resolveRequestId(req.headers['x-request-id']);
    req.id = requestId;
    res.setHeader('x-request-id', requestId);

    requestContext.run(
      {
        requestId,
        ip: req.ip,
        userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : undefined,
      },
      next,
    );
  });

  // See api-prefix.ts for why this must keep its leading slash.
  app.setGlobalPrefix(API_PREFIX);
  app.useGlobalPipes(new ZodValidationPipe());
  app.useGlobalFilters(new ProblemExceptionFilter(logger));
  app.enableShutdownHooks();

  setupOpenApi(app);
}
