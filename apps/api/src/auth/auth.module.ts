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
    // Fail-closed by design: every route is protected unless @Public(). Nest
    // runs APP_GUARD providers in registration order, and PermissionsGuard
    // depends on req.actor, which only this guard sets, so this one is
    // registered first.
    { provide: APP_GUARD, useClass: SessionGuard },
    // Registered under its own class token as well as as a guard, with
    // useExisting rather than a second useClass: two useClass registrations
    // would construct two separate instances. The single instance is what
    // lets the scope-resolver tests call `app.get(PermissionsGuard)` and
    // exercise `loadFacts` directly without going through HTTP.
    //
    // Must come AFTER SessionGuard, above: req.actor has to be populated by
    // the time this one runs.
    PermissionsGuard,
    { provide: APP_GUARD, useExisting: PermissionsGuard },
  ],
  exports: [TokensService],
})
export class AuthModule {}
