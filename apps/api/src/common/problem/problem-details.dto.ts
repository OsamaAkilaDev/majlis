import { problemDetailsSchema } from '@majlis/contracts';
import { createZodDto } from 'nestjs-zod';

/**
 * The one class every `@ApiResponse({ type: ProblemDetailsDto })` in the
 * codebase references. `problemDetailsSchema` is the same schema
 * `problem.filter.ts` builds every error body from (imported there only as
 * a type), so this is a single generated component in the OpenAPI document
 * rather than a hand-written schema re-typed at each error-declaring route —
 * exactly the pipeline `cleanupOpenApiDoc` expects a DTO's schema to travel
 * through.
 */
export class ProblemDetailsDto extends createZodDto(problemDetailsSchema) {}
