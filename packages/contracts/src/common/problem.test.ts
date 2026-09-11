import { describe, expect, it } from 'vitest';
import { PROBLEM_BASE, problemDetailsSchema } from './problem';

describe('PROBLEM_BASE', () => {
  it('is the single source every problem type URI is built from', () => {
    expect(PROBLEM_BASE).toBe('https://majlis.app/problems');
  });
});

describe('problemDetailsSchema', () => {
  it('defaults type to about:blank when omitted', () => {
    const parsed = problemDetailsSchema.parse({ title: 'Not Found', status: 404 });
    expect(parsed.type).toBe('about:blank');
  });

  it('accepts a full problem with field errors', () => {
    const parsed = problemDetailsSchema.parse({
      type: 'https://majlis.app/problems/validation-failed',
      title: 'Validation failed',
      status: 400,
      detail: 'The request body is invalid.',
      instance: '/api/v1/clubs',
      requestId: '01J000000000000000000000',
      errors: [{ path: 'name', message: 'Required', code: 'invalid_type' }],
    });
    expect(parsed.errors).toHaveLength(1);
    expect(parsed.errors?.[0]?.path).toBe('name');
  });

  it('rejects a status outside the HTTP range', () => {
    expect(() => problemDetailsSchema.parse({ title: 'Nope', status: 99 })).toThrow();
    expect(() => problemDetailsSchema.parse({ title: 'Nope', status: 600 })).toThrow();
  });

  it('requires a title', () => {
    expect(() => problemDetailsSchema.parse({ status: 500 })).toThrow();
  });
});
