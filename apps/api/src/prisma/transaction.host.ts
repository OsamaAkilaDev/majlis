import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { Prisma } from '../generated/prisma/client';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- must stay a value import: Nest's constructor DI resolves this provider from the emitted `design:paramtypes` metadata, which needs a real runtime reference.
import { PrismaService } from './prisma.service';

/**
 * A Prisma client scoped to a transaction: the connection-level methods are
 * gone. This is Prisma's own type rather than a hand-rolled `Omit`, so it
 * stays exactly in step with whatever `$transaction` actually hands back.
 */
export type TransactionClient = Prisma.TransactionClient;

/**
 * Carries the current transaction implicitly through the call stack.
 *
 * Services read `host.tx` instead of `prisma`, so a helper called five frames
 * down (the audit writer, most importantly) automatically enlists in the
 * caller's transaction without being handed one. That is what makes
 * "the audit row is written in the same transaction as the action" a
 * structural property rather than something a reviewer has to catch.
 */
@Injectable()
export class TransactionHost {
  private readonly storage = new AsyncLocalStorage<TransactionClient>();

  constructor(private readonly prisma: PrismaService) {}

  /** The ambient transaction if one is open, otherwise the base client. */
  get tx(): TransactionClient {
    return this.storage.getStore() ?? this.prisma;
  }

  /**
   * Runs `fn` inside a transaction. If a transaction is already open on this
   * async context, `fn` joins it: Postgres has no true nested transactions,
   * and a savepoint here would let an inner failure be swallowed while the
   * outer action commits, which is exactly the bug this design prevents.
   */
  async run<T>(fn: () => Promise<T>): Promise<T> {
    const ambient = this.storage.getStore();
    if (ambient) return fn();

    return this.prisma.$transaction((tx) => this.storage.run(tx, fn));
  }
}
