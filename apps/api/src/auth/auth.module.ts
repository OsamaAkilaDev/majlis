import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import type { Env } from '../config/env.schema';
import { SessionGuard } from './session.guard';
import { TokensService } from './tokens.service';

@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        secret: config.get('SESSION_SECRET', { infer: true }),
      }),
    }),
  ],
  providers: [
    TokensService,
    // Fail-closed by design: every route is protected unless @Public(). Task
    // 8 adds PermissionsGuard as a second APP_GUARD immediately after this
    // one — Nest runs APP_GUARD providers in registration order, and
    // PermissionsGuard depends on req.actor, which only this guard sets.
    { provide: APP_GUARD, useClass: SessionGuard },
  ],
  exports: [TokensService],
})
export class AuthModule {}
