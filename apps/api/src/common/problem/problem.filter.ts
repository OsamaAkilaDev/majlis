import {
  Catch,
  HttpException,
  HttpStatus,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type { ProblemDetails, ProblemFieldError } from '@majlis/contracts';
import type { Logger } from 'nestjs-pino';
import { ZodValidationException } from 'nestjs-zod';
import { ZodError } from 'zod';
import { DomainError } from './domain-error';

const PROBLEM_BASE = 'https://majlis.app/problems';

/** Narrow structural check — avoids importing Prisma error classes here. */
function isPrismaError(e: unknown): e is { code: string; message: string } {
  return typeof e === 'object' && e !== null && typeof (e as { code?: unknown }).code === 'string';
}

/**
 * Validation failures reach us two ways: a bare ZodError from code that parses
 * a schema directly, and a ZodValidationException from nestjs-zod's global
 * pipe, which wraps one. Both must produce the same field-level response.
 */
function asZodError(e: unknown): ZodError | undefined {
  if (e instanceof ZodError) return e;
  if (e instanceof ZodValidationException) {
    const inner = e.getZodError();
    if (inner instanceof ZodError) return inner;
  }
  return undefined;
}

@Catch()
export class ProblemExceptionFilter implements ExceptionFilter {
  constructor(private readonly logger: Logger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const req = http.getRequest<{ url?: string; originalUrl?: string; id?: string }>();
    const res = http.getResponse<{
      type: (t: string) => { status: (s: number) => { json: (b: unknown) => void } };
    }>();

    const problem = this.toProblem(exception, req);

    if (problem.status >= 500) {
      this.logger.error({ err: exception, requestId: problem.requestId }, 'Unhandled exception');
    } else {
      this.logger.warn({ requestId: problem.requestId, status: problem.status }, problem.title);
    }

    res.type('application/problem+json').status(problem.status).json(problem);
  }

  private toProblem(
    exception: unknown,
    req: { url?: string; originalUrl?: string; id?: string },
  ): ProblemDetails {
    // originalUrl survives Express mounting a sub-router at the global
    // prefix for the not-found handler, where req.url is rewritten to the
    // path relative to that mount point (e.g. "/nope" instead of
    // "/api/v1/nope"). Fall back to url for the mocked hosts in unit tests.
    const base = { instance: req.originalUrl ?? req.url, requestId: req.id };

    if (exception instanceof DomainError) {
      return {
        ...base,
        type: exception.type,
        title: exception.title,
        status: exception.status,
        detail: exception.message,
      };
    }

    // MUST come before the HttpException branch: nestjs-zod's
    // ZodValidationException extends BadRequestException, so checking
    // HttpException first would swallow it and drop every field error.
    const zodError = asZodError(exception);
    if (zodError) {
      const errors: ProblemFieldError[] = zodError.issues.map((i) => ({
        path: i.path.join('.'),
        message: i.message,
        code: i.code,
      }));
      return {
        ...base,
        type: `${PROBLEM_BASE}/validation-failed`,
        title: 'Validation failed',
        status: 400,
        detail: 'The request did not match the expected shape.',
        errors,
      };
    }

    if (isPrismaError(exception)) {
      // A lost race on a unique index is an expected outcome under
      // concurrency, not a server fault. It must never surface as a 500.
      if (exception.code === 'P2002') {
        return {
          ...base,
          type: `${PROBLEM_BASE}/conflict`,
          title: 'Conflict',
          status: 409,
          detail: 'This conflicts with an existing record. Reload and try again.',
        };
      }
      if (exception.code === 'P2025') {
        return {
          ...base,
          type: `${PROBLEM_BASE}/not-found`,
          title: 'Not found',
          status: 404,
          detail: 'The requested record does not exist.',
        };
      }
      if (exception.code === 'P2003') {
        return {
          ...base,
          type: `${PROBLEM_BASE}/conflict`,
          title: 'Conflict',
          status: 409,
          detail: 'A referenced record does not exist or is still in use.',
        };
      }
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const response = exception.getResponse();
      const detail =
        typeof response === 'string'
          ? response
          : ((response as { message?: string | string[] }).message as string | undefined);
      return {
        ...base,
        type: `${PROBLEM_BASE}/http-error`,
        title: exception.name.replace(/Exception$/, ''),
        status,
        detail: Array.isArray(detail) ? detail.join('; ') : (detail ?? exception.message),
      };
    }

    // Anything else is a bug. The real cause is logged above; the client
    // gets only a request id to quote.
    return {
      ...base,
      type: `${PROBLEM_BASE}/internal`,
      title: 'Internal server error',
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      detail: 'An unexpected error occurred.',
    };
  }
}
