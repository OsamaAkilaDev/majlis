import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestFacts {
  requestId: string;
  ip?: string;
  userAgent?: string;
}

/**
 * Ambient per-request facts. `audit_log.request_id` is NOT NULL, and `ip` is
 * wanted, but threading both through every service signature would put two
 * parameters on every method in the codebase for the benefit of one writer.
 *
 * This mirrors TransactionHost deliberately: the codebase then has one
 * pattern for ambient context rather than two. A Nest REQUEST-scoped
 * provider was rejected: request scope propagates up the injection graph,
 * so one request-scoped audit service makes every service that consumes it
 * request-scoped too.
 */
@Injectable()
export class RequestContext {
  private readonly storage = new AsyncLocalStorage<RequestFacts>();

  get current(): RequestFacts | undefined {
    return this.storage.getStore();
  }

  run<T>(facts: RequestFacts, fn: () => T): T {
    return this.storage.run(facts, fn);
  }
}
