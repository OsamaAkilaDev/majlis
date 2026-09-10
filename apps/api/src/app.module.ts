import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { randomUUID } from 'node:crypto';
import { ConfigModule } from './config/config.module';
import type { Env } from './config/env.schema';
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
          genReqId: (req, res) => {
            const id = (req.headers['x-request-id'] as string) ?? randomUUID();
            res.setHeader('x-request-id', id);
            return id;
          },
          // Nothing secret ever reaches a log line.
          redact: {
            paths: [
              'req.headers.cookie',
              'req.headers.authorization',
              'req.body.password',
              'req.body.token',
              'res.headers["set-cookie"]',
            ],
            remove: true,
          },
          transport:
            config.get('NODE_ENV', { infer: true }) === 'development'
              ? { target: 'pino-pretty', options: { singleLine: true } }
              : undefined,
        },
      }),
    }),
    PrismaModule,
    HealthModule,
  ],
})
export class AppModule {}
