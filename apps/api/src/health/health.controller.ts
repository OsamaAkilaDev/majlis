import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/public.decorator';
import { TransactionHost } from '../prisma/transaction.host';

// @Public() because a load balancer or uptime monitor pings this before any
// session exists. It exposes nothing sensitive: a status and a database round
// trip, per spec 11.
@ApiTags('ops')
@Controller('health')
export class HealthController {
  constructor(private readonly host: TransactionHost) {}

  // Minimal on purpose: the scanner screen pings this on open to warm a cold
  // instance before the first student reaches the door.
  @Public()
  @Get()
  @ApiOkResponse({ description: 'Service and database are reachable.' })
  async check(): Promise<{ status: 'ok'; database: 'up'; uptimeSeconds: number }> {
    await this.host.tx.$queryRaw`SELECT 1`;
    return { status: 'ok', database: 'up', uptimeSeconds: Math.round(process.uptime()) };
  }
}
