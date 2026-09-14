import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
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
  ],
  controllers: [AuthController],
  providers: [
    TokensService,
    AuthService,
    // Fail-closed by design: every route is protected unless @Public(). Task
    // 8 adds PermissionsGuard as a third APP_GUARD after this one. Nest
    // runs APP_GUARD providers in registration order, and PermissionsGuard
    // depends on req.actor, which only this guard sets.
    { provide: APP_GUARD, useClass: SessionGuard },
    // Global (not per-controller): PermissionsGuard denies with a thrown
    // ForbiddenError, and Nest's guard chain stops at the first guard that
    // registered on the controller runs AFTER every global guard (Nest
    // composes [global..., class..., method...] guards, in that order), so
    // it would never even be reached for a denied request. That was
    // let a denied STUDENT loop `GET /users` well past 60 requests with no
    // 429, because PermissionsGuard's denial always fires first. Registered
    // to deny (429) BEFORE PermissionsGuard ever gets a chance to deny (403)
    // and write another permission.denied row, closing the exact gap F1
    // balancer's health probes are unaffected; AuthController keeps its
    // instance rather than a second, redundant local one.
    // Registered under its own class token too (useExisting, not a second
    // useClass: that would construct two separate instances), so the
    // scope-resolver tests can `app.get(PermissionsGuard)` and call
    // `loadFacts` directly without going through HTTP. Must be registered
    // AFTER SessionGuard (see above): req.actor must already be populated
    // by the time this one runs.
    PermissionsGuard,
    { provide: APP_GUARD, useExisting: PermissionsGuard },
  ],
  exports: [TokensService],
})
export class AuthModule {}
