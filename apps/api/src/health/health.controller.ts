import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/public.decorator';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- must stay a value import: Nest's constructor DI resolves this provider from the emitted `design:paramtypes` metadata, which needs a real runtime reference.
import { TransactionHost } from '../prisma/transaction.host';

/**
 * auth.module.ts) — this is what a load balancer or uptime monitor pings
 * repeatedly to keep a serverless instance warm, and it predates F1's fix
 * above 60/min would start getting 429s for no reason connected to F1's
 * actual concern (the append-only audit table).
 */
@ApiTags('ops')
@Controller('health')
export class HealthController {
  constructor(private readonly host: TransactionHost) {}

  /**
   * Deliberately minimal. The scanner screen pings this on open to warm a
   * cold serverless instance before the first student reaches the door.
   *
   * Goes through `host.tx` like every other database read: with no ambient
   * transaction open it returns the base client, so this is the same query
   * on the same connection it always was.
   */
  @Public()
  @Get()
  @ApiOkResponse({ description: 'Service and database are reachable.' })
  async check(): Promise<{ status: 'ok'; database: 'up'; uptimeSeconds: number }> {
    await this.host.tx.$queryRaw`SELECT 1`;
    return { status: 'ok', database: 'up', uptimeSeconds: Math.round(process.uptime()) };
  }
}
