import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/public.decorator';
import { TransactionHost } from '../prisma/transaction.host';

/**
 * The health check. @Public() because this is what a load balancer or an
 * uptime monitor pings, and it must answer before any session exists.
 * It exposes nothing sensitive: a status and a database round trip, per
 * spec section 11.
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
