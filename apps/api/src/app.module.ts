import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { RequestContextModule } from './common/request-context.module';
import { resolveRequestId } from './common/request-id';
import { ConfigModule } from './config/config.module';
import type { Env } from './config/env.schema';
import { LOG_REDACT_PATHS, redactedReqSerializer } from './config/log-redaction';
import { DepartmentsModule } from './departments/departments.module';
import { HealthModule } from './health/health.module';
import { PrismaModule } from './prisma/prisma.module';
import { StorageModule } from './storage/storage.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    ConfigModule,
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        pinoHttp: {
          level: config.get('LOG_LEVEL', { infer: true }),
          // Belt and braces, deliberately: configure-app.ts's
          // request-context middleware already assigns req.id and the
          // x-request-id response header before pino-http runs, on every
          // real entry point today (main.ts, every integration test). This
          // fallback exists for a bootstrap path that skips configureApp()
          // — nothing enforces that every future one won't. pino-http's own
          // `req.id = req.id || genReqId(...)` (pino-http/logger.js) makes
          // this completely inert whenever configureApp's middleware has
          // already run; it only ever fires otherwise. Do not remove it as
          // dead code — that was tried and reverted, see PR review.
          genReqId: (req, res) => {
            const id = resolveRequestId(req.headers['x-request-id']);
            res.setHeader('x-request-id', id);
            return id;
          },
          // Nothing secret ever reaches a log line. The paths live in their
          // own module so they can be tested against real pino output.
          redact: { paths: [...LOG_REDACT_PATHS], remove: true },
          serializers: { req: redactedReqSerializer },
          transport:
            config.get('NODE_ENV', { infer: true }) === 'development'
              ? { target: 'pino-pretty', options: { singleLine: true } }
              : undefined,
        },
      }),
    }),
    RequestContextModule,
    PrismaModule,
    AuditModule,
    AuthModule,
    UsersModule,
    DepartmentsModule,
    HealthModule,
    StorageModule,
  ],
})
export class AppModule {}
