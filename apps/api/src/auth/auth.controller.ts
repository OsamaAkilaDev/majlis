import { Body, Controller, HttpCode, Post, Req, Res, UseGuards } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- must stay a value import: Nest's constructor DI resolves this provider from the emitted `design:paramtypes` metadata, which needs a real runtime reference.
import { ConfigService } from '@nestjs/config';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { loginBodySchema, signupBodySchema, type SessionUser } from '@majlis/contracts';
import type { Request, Response } from 'express';
import { createZodDto } from 'nestjs-zod';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- must stay a value import: Nest's constructor DI resolves this provider from the emitted `design:paramtypes` metadata, which needs a real runtime reference. AuthResult is a type-only member of the same module, so it rides along here rather than a second import statement.
import { AuthService, SESSION_EXPIRED, type AuthResult } from './auth.service';
import {
  refreshCookieOptions,
  sessionCookieOptions,
  REFRESH_COOKIE,
  SESSION_COOKIE,
} from './cookies';
import { UnauthorizedError } from '../common/problem/domain-error';
import { Public } from './public.decorator';
import type { Env } from '../config/env.schema';

class SignupDto extends createZodDto(signupBodySchema) {}
class LoginDto extends createZodDto(loginBodySchema) {}

/**
 * Signup and login — the first endpoints in the product that issue a
 * session. Both are @Public(): SessionGuard is a global APP_GUARD, so a
 * route that forgets this decorator is simply unreachable by anyone who
 * isn't already signed in.
 *
 * ThrottlerGuard is applied here, on the controller, rather than as another
 * global APP_GUARD — so no other endpoint gets a surprise rate limit it
 * never asked for.
 */
@UseGuards(ThrottlerGuard)
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  @Public()
  @Throttle({ default: { limit: 3, ttl: 3_600_000 } })
  @Post('signup')
  @HttpCode(201)
  async signup(@Body() body: SignupDto, @Res({ passthrough: true }) res: Response): Promise<SessionUser> {
    const result = await this.auth.signup(body);
    this.setAuthCookies(res, result);
    return result.user;
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('login')
  @HttpCode(200)
  async login(@Body() body: LoginDto, @Res({ passthrough: true }) res: Response): Promise<SessionUser> {
    const result = await this.auth.login(body);
    this.setAuthCookies(res, result);
    return result.user;
  }

  /**
   * @Public(): SessionGuard checks the session cookie, which is exactly what
   * refresh exists to replace once it has expired — requiring a valid one
   * here would make the endpoint unusable for the one case it's for.
   */
  @Public()
  @Post('refresh')
  @HttpCode(200)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<SessionUser> {
    const raw = req.cookies?.[REFRESH_COOKIE] as string | undefined;
    // Same message and status as every failure inside AuthService.refresh —
    // a missing cookie is not a distinguishable case either.
    if (!raw) throw new UnauthorizedError(SESSION_EXPIRED);

    const result = await this.auth.refresh(raw);
    this.setAuthCookies(res, result);
    return result.user;
  }

  /**
   * @Public(): an expired (or already cleared) access token must not block
   * logging out. Always 204 — see AuthService.logout's doc comment for why
   * "no cookie", "unknown token", and "already revoked" all succeed.
   */
  @Public()
  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    const raw = req.cookies?.[REFRESH_COOKIE] as string | undefined;
    await this.auth.logout(raw);

    const isProduction = this.config.get('NODE_ENV', { infer: true }) === 'production';
    res.clearCookie(SESSION_COOKIE, sessionCookieOptions(isProduction));
    res.clearCookie(REFRESH_COOKIE, refreshCookieOptions(isProduction));
  }

  /**
   * Tokens live only in httpOnly cookies, never in the JSON response body —
   * the response body is the session user and nothing else, so a token
   * never ends up in a browser devtools network log or an API client's
   * response history.
   */
  private setAuthCookies(res: Response, result: AuthResult): void {
    const isProduction = this.config.get('NODE_ENV', { infer: true }) === 'production';
    res.cookie(SESSION_COOKIE, result.accessToken, sessionCookieOptions(isProduction));
    res.cookie(REFRESH_COOKIE, result.refreshToken, refreshCookieOptions(isProduction));
  }
}
