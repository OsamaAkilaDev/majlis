import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerModule } from '@nestjs/throttler';
import type { Env } from '../config/env.schema';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PermissionsGuard } from './permissions.guard';
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
    // A generous, unnamed "default" bucket — @Throttle on signup/login
    // overrides it with the specific limits Task 9 requires. Applied via
    // ThrottlerGuard on AuthController only (see auth.controller.ts), never
    // as a global APP_GUARD, so no other endpoint inherits a rate limit it
    // never asked for.
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 60 }]),
  ],
  controllers: [AuthController],
  providers: [
    TokensService,
    AuthService,
    // Fail-closed by design: every route is protected unless @Public(). Task
    // 8 adds PermissionsGuard as a second APP_GUARD immediately after this
    // one — Nest runs APP_GUARD providers in registration order, and
    // PermissionsGuard depends on req.actor, which only this guard sets.
    { provide: APP_GUARD, useClass: SessionGuard },
    // Registered under its own class token too (useExisting, not a second
    // useClass — that would construct two separate instances), so the
    // scope-resolver tests can `app.get(PermissionsGuard)` and call
    // `loadFacts` directly without going through HTTP. Must be registered
    // AFTER SessionGuard (see above) — req.actor must already be populated
    // by the time this one runs.
    PermissionsGuard,
    { provide: APP_GUARD, useExisting: PermissionsGuard },
  ],
  exports: [TokensService],
})
export class AuthModule {}
