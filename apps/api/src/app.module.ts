import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { RequestContextModule } from './common/request-context.module';
import { ConfigModule } from './config/config.module';
import type { Env } from './config/env.schema';
import { LOG_REDACT_PATHS } from './config/log-redaction';
import { HealthModule } from './health/health.module';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [
    ConfigModule,
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        pinoHttp: {
          level: config.get('LOG_LEVEL', { infer: true }),
          // No genReqId here: configure-app.ts's request-context middleware
          // assigns req.id (from x-request-id if the caller sent one, else a
          // fresh uuid) and sets the response header before pino-http ever
          // runs. pino-http's own `req.id = req.id || genReqId(...)` then
          // just adopts that value, so this stays the one place that
          // derives it.
          // Nothing secret ever reaches a log line. The paths live in their
          // own module so they can be tested against real pino output.
          redact: { paths: [...LOG_REDACT_PATHS], remove: true },
          transport:
            config.get('NODE_ENV', { infer: true }) === 'development'
              ? { target: 'pino-pretty', options: { singleLine: true } }
              : undefined,
        },
      }),
    }),
    RequestContextModule,
    PrismaModule,
    HealthModule,
  ],
})
export class AppModule {}
