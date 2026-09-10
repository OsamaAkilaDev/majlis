/**
 * Business-rule failures. Services throw these; the global filter is the only
 * place that knows how to turn one into an HTTP response, so no service ever
 * imports anything from @nestjs/common to report a rule violation.
 */
export abstract class DomainError extends Error {
  abstract readonly status: number;
  abstract readonly type: string;
  abstract readonly title: string;

  constructor(detail: string) {
    super(detail);
    this.name = new.target.name;
  }
}

export class NotFoundError extends DomainError {
  readonly status = 404;
  readonly type = 'https://majlis.app/problems/not-found';
  readonly title = 'Not found';
}

export class ForbiddenError extends DomainError {
  readonly status = 403;
  readonly type = 'https://majlis.app/problems/forbidden';
  readonly title = 'Forbidden';
}

export class ConflictError extends DomainError {
  readonly status = 409;
  readonly type = 'https://majlis.app/problems/conflict';
  readonly title = 'Conflict';
}

export class UnprocessableError extends DomainError {
  readonly status = 422;
  readonly type = 'https://majlis.app/problems/unprocessable';
  readonly title = 'Unprocessable';
}
