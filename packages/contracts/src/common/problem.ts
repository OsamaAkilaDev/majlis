import { z } from 'zod';

/**
 * Base URI for every Problem Details `type` this API emits. Both the
 * DomainError subclasses and the exception filter's own ad-hoc problem
 * types (validation, conflict, not-found, http-error, internal) build their
 * full URI from this constant, so the two never drift into different bases.
 */
export const PROBLEM_BASE = 'https://majlis.app/problems';

/** A single field-level validation failure inside a Problem Details response. */
export const problemFieldErrorSchema = z.object({
  path: z.string(),
  message: z.string(),
  code: z.string().optional(),
});

/** RFC 9457 Problem Details, plus the two extension members Majlis always sends. */
export const problemDetailsSchema = z.object({
  type: z.string().default('about:blank'),
  title: z.string(),
  status: z.number().int().min(100).max(599),
  detail: z.string().optional(),
  instance: z.string().optional(),
  requestId: z.string().optional(),
  errors: z.array(problemFieldErrorSchema).optional(),
});

export type ProblemFieldError = z.infer<typeof problemFieldErrorSchema>;
export type ProblemDetails = z.infer<typeof problemDetailsSchema>;
