import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestFacts {
  requestId: string;
  ip?: string;
  userAgent?: string;
}

/**
 * Ambient per-request facts, mirroring TransactionHost so there is one
 * pattern for ambient context rather than two.
 *
 * NOT a Nest REQUEST-scoped provider: request scope propagates up the
 * injection graph, so one request-scoped audit service would make every
 * service consuming it request-scoped too.
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
