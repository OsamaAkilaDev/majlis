import { BadRequestException, HttpStatus, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { ZodValidationException } from 'nestjs-zod';
import type { ZodError} from 'zod';
import { z } from 'zod';
import { ConflictError, ForbiddenError, NotFoundError } from './domain-error';
import { ProblemExceptionFilter } from './problem.filter';

function invokeFilter(exception: unknown) {
  const json = vi.fn();
  const status = vi.fn().mockReturnValue({ json });
  const type = vi.fn().mockReturnValue({ status });
  const host = {
    switchToHttp: () => ({
      getResponse: () => ({ type, status, json }),
      getRequest: () => ({ url: '/api/v1/clubs', id: 'req-abc' }),
    }),
  };

  const logger = { error: vi.fn(), warn: vi.fn() };
  const filter = new ProblemExceptionFilter(logger as never);
  filter.catch(exception, host as never);

  return { body: json.mock.calls[0]?.[0], status: status.mock.calls[0]?.[0], type };
}

describe('ProblemExceptionFilter', () => {
  it('sets the application/problem+json content type', () => {
    const { type } = invokeFilter(new NotFoundError('No such club.'));
    expect(type).toHaveBeenCalledWith('application/problem+json');
  });

  it('maps a domain NotFoundError to 404 with its type and title', () => {
    const { body, status } = invokeFilter(new NotFoundError('No such club.'));
    expect(status).toBe(404);
    expect(body).toMatchObject({
      type: 'https://majlis.app/problems/not-found',
      title: 'Not found',
      status: 404,
      detail: 'No such club.',
      instance: '/api/v1/clubs',
      requestId: 'req-abc',
    });
  });

  it('maps a domain ConflictError to 409', () => {
    expect(invokeFilter(new ConflictError('Event is full.')).status).toBe(409);
  });

  it('maps a domain ForbiddenError to 403', () => {
    expect(invokeFilter(new ForbiddenError('Not your club.')).status).toBe(403);
  });

  it('maps a Zod error to 400 with field-level errors', () => {
    const schema = z.object({ name: z.string(), capacity: z.number() });
    let zodError: ZodError;
    try {
      schema.parse({ capacity: 'lots' });
      throw new Error('should not reach');
    } catch (e) {
      zodError = e as ZodError;
    }

    const { body, status } = invokeFilter(zodError!);
    expect(status).toBe(400);
    expect(body.title).toBe('Validation failed');
    expect(body.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'name' }),
        expect.objectContaining({ path: 'capacity' }),
      ]),
    );
  });

  it("maps nestjs-zod's ZodValidationException to 400 WITH field errors", () => {
    // This is the shape the global pipe actually throws. Because it extends
    // BadRequestException, a filter checking HttpException first would return
    // a bare 400 and silently drop every field error.
    const schema = z.object({ title: z.string() });
    let inner: ZodError;
    try {
      schema.parse({});
      throw new Error('should not reach');
    } catch (e) {
      inner = e as ZodError;
    }

    const { body, status } = invokeFilter(new ZodValidationException(inner!));
    expect(status).toBe(400);
    expect(body.title).toBe('Validation failed');
    expect(body.errors).toEqual([expect.objectContaining({ path: 'title' })]);
  });

  it('maps a Prisma unique-violation to 409, not 500 — a lost race is expected, not a fault', () => {
    const p2002 = Object.assign(new Error('Unique constraint failed'), {
      code: 'P2002',
      meta: { target: ['event_id', 'user_id'] },
    });
    const { body, status } = invokeFilter(p2002);
    expect(status).toBe(409);
    expect(body.type).toBe('https://majlis.app/problems/conflict');
  });

  it('maps a Prisma record-not-found (P2025) to 404', () => {
    const p2025 = Object.assign(new Error('Record not found'), { code: 'P2025' });
    expect(invokeFilter(p2025).status).toBe(404);
  });

  it('maps a Prisma inconsistent-column-data (P2023) to 400, not 500 — a malformed :id is a client error', () => {
    // Catches the pre-fix gap: without this branch, "not-a-uuid" against a
    // @db.Uuid column falls through to the generic 500 branch below, which
    // also risks echoing Prisma's own message — it embeds the failing
    // call's arguments, including passwordHash on the signup path.
    const p2023 = Object.assign(
      new Error('Inconsistent column data: invalid input syntax for type uuid: "not-a-uuid"'),
      { code: 'P2023' },
    );
    const { body, status } = invokeFilter(p2023);
    expect(status).toBe(400);
    expect(body.detail).not.toContain('not-a-uuid');
  });

  it('maps a Prisma data-validation error (P2007) to 400 too — the code the pg driver adapter actually raises', () => {
    // Verified live: prisma@7.10.0 with @prisma/adapter-pg (this project's
    // driver) surfaces a malformed uuid as P2007, not P2023, wrapping the
    // same underlying Postgres 22P02. Catches a filter that maps only P2023
    // — that would leave this project's actual malformed-:id failure mode
    // as an unhandled 500 despite "fixing" F2.
    const p2007 = Object.assign(new Error('Data validation error'), {
      code: 'P2007',
      meta: { driverAdapterError: { cause: { originalMessage: 'invalid input syntax for type uuid: "not-a-uuid"' } } },
    });
    const { body, status } = invokeFilter(p2007);
    expect(status).toBe(400);
    expect(body.detail).not.toContain('not-a-uuid');
  });

  it('passes a Nest HttpException through at its own status', () => {
    expect(invokeFilter(new NotFoundException('nope')).status).toBe(404);
    expect(invokeFilter(new BadRequestException('bad')).status).toBe(400);
  });

  it('turns an unknown error into a 500 that leaks nothing', () => {
    const { body, status } = invokeFilter(new Error('DB password is hunter2'));
    expect(status).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(body.detail).toBe('An unexpected error occurred.');
    expect(JSON.stringify(body)).not.toContain('hunter2');
    expect(body.requestId).toBe('req-abc');
  });

  it('logs the real cause of a 500 even though the response hides it', () => {
    const json = vi.fn();
    const status = vi.fn().mockReturnValue({ json });
    const type = vi.fn().mockReturnValue({ status });
    const host = {
      switchToHttp: () => ({
        getResponse: () => ({ type, status, json }),
        getRequest: () => ({ url: '/x', id: 'r' }),
      }),
    };
    const logger = { error: vi.fn(), warn: vi.fn() };
    new ProblemExceptionFilter(logger as never).catch(new Error('hunter2'), host as never);
    expect(logger.error).toHaveBeenCalled();
  });
});
