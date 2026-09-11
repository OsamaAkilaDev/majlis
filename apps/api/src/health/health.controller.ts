import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- must stay a value import: Nest's constructor DI resolves this provider from the emitted `design:paramtypes` metadata, which needs a real runtime reference.
import { PrismaService } from '../prisma/prisma.service';

@ApiTags('ops')
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Deliberately minimal. The scanner screen pings this on open to warm a
   * cold serverless instance before the first student reaches the door.
   */
  @Get()
  @ApiOkResponse({ description: 'Service and database are reachable.' })
  async check(): Promise<{ status: 'ok'; database: 'up'; uptimeSeconds: number }> {
    await this.prisma.$queryRaw`SELECT 1`;
    return { status: 'ok', database: 'up', uptimeSeconds: Math.round(process.uptime()) };
  }
}
