import { Body, Controller, Get, HttpCode, Post, Query, Req, Res } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- must stay a value import: Nest's constructor DI resolves this provider from the emitted `design:paramtypes` metadata, which needs a real runtime reference.
import { ConfigService } from '@nestjs/config';
import { ApiResponse } from '@nestjs/swagger';
import {
  ADMIN_ALREADY_EXISTS,
  forgotPasswordBodySchema,
  loginBodySchema,
  resetPasswordBodySchema,
  resetPasswordPreviewQuerySchema,
  signupBodySchema,
  type BootstrapStatus,
  type ResetPasswordPreview,
  type SessionUser,
} from '@majlis/contracts';
import type { Request, Response } from 'express';
import { createZodDto } from 'nestjs-zod';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- must stay a value import: Nest's constructor DI resolves this provider from the emitted `design:paramtypes` metadata, which needs a real runtime reference. AuthResult is a type-only member of the same module, so it rides along here rather than a second import statement.
import { AuthService, RESET_LINK_INVALID, SESSION_EXPIRED, type AuthResult } from './auth.service';
import {
  refreshCookieOptions,
  secureCookies,
  sessionCookieOptions,
  REFRESH_COOKIE,
  SESSION_COOKIE,
} from './cookies';
import { Actor } from './actor.decorator';
import { ProblemDetailsDto } from '../common/problem/problem-details.dto';
import { UnauthorizedError } from '../common/problem/domain-error';
import type { User } from '../generated/prisma/client';
import { Public } from './public.decorator';
import type { Env } from '../config/env.schema';

class SignupDto extends createZodDto(signupBodySchema) {}
// The same three fields under the same rules, deliberately not a second
// schema: the first admin is created with exactly the body a signup
// carries, and the two must never drift apart on password length or email
// normalisation.
class BootstrapAdminDto extends createZodDto(signupBodySchema) {}
class LoginDto extends createZodDto(loginBodySchema) {}
class ForgotPasswordDto extends createZodDto(forgotPasswordBodySchema) {}
class ResetPasswordDto extends createZodDto(resetPasswordBodySchema) {}
class ResetPasswordPreviewQueryDto extends createZodDto(resetPasswordPreviewQuerySchema) {}

/**
 * Signup and login, the first endpoints in the product that issue a
 * session. Both are @Public(): SessionGuard is a global APP_GUARD, so a
 * route that forgets this decorator is simply unreachable by anyone who
 * isn't already signed in.
 *
 * every route gets the 60/min default bucket unless it opts out with
 * limit/window for these two routes; it does not register a second guard.
 */
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  @Public()
  @Post('signup')
  @HttpCode(201)
  @ApiResponse({ status: 409, description: 'An account with this email already exists.', type: ProblemDetailsDto })
  async signup(@Body() body: SignupDto, @Res({ passthrough: true }) res: Response): Promise<SessionUser> {
    const result = await this.auth.signup(body);
    this.setAuthCookies(res, result);
    return result.user;
  }

  /**
   * @Public(): read by the create-admin screen, which by definition is shown
   * to somebody who has no account to sign in with.
   */
  @Public()
  @Get('bootstrap')
  bootstrapStatus(): Promise<BootstrapStatus> {
    return this.auth.bootstrapStatus();
  }

  /**
   * @Public() and unauthenticated on purpose: it is what creates the first
   * admin on a fresh deployment, so there is no admin to authorize it. The
   * "no admin exists yet" check in AuthService.bootstrapAdmin is the whole
   * of the authorization, and it is enforced under an advisory lock rather
   * than by this decorator's absence.
   */
  @Public()
  @Post('bootstrap')
  @HttpCode(201)
  @ApiResponse({ status: 409, description: ADMIN_ALREADY_EXISTS, type: ProblemDetailsDto })
  async bootstrap(
    @Body() body: BootstrapAdminDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SessionUser> {
    const result = await this.auth.bootstrapAdmin(body);
    this.setAuthCookies(res, result);
    return result.user;
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  @ApiResponse({ status: 401, description: 'Email or password is incorrect.', type: ProblemDetailsDto })
  @ApiResponse({ status: 403, description: 'This account is suspended.', type: ProblemDetailsDto })
  async login(@Body() body: LoginDto, @Res({ passthrough: true }) res: Response): Promise<SessionUser> {
    const result = await this.auth.login(body);
    this.setAuthCookies(res, result);
    return result.user;
  }

  /**
   * @Public(), and always 202 whether or not the address resolves. A
   * different answer for a real address would make this an
   * account-existence oracle, which is precisely the defect Stage 6's review
   * found on manual check-in.
   */
  @Public()
  @Post('forgot-password')
  @HttpCode(202)
  async forgotPassword(@Body() body: ForgotPasswordDto): Promise<void> {
    await this.auth.forgotPassword(body);
  }

  /**
   * @Public(), and read-only: it names the account a link belongs to so the
   * reset screen can show the address instead of the token. It must never
   * consume the link, or opening the page would spend it.
   */
  @Public()
  @Get('reset-password')
  @ApiResponse({ status: 401, description: RESET_LINK_INVALID, type: ProblemDetailsDto })
  previewReset(@Query() query: ResetPasswordPreviewQueryDto): Promise<ResetPasswordPreview> {
    return this.auth.previewReset(query);
  }

  /**
   * @Public(): the whole point is that the caller cannot sign in. Expired,
   * used and unknown tokens all answer 401 with the same message.
   */
  @Public()
  @Post('reset-password')
  @HttpCode(204)
  @ApiResponse({ status: 401, description: RESET_LINK_INVALID, type: ProblemDetailsDto })
  async resetPassword(@Body() body: ResetPasswordDto): Promise<void> {
    await this.auth.resetPassword(body);
  }

  /**
   * Not @Public(): this is the one endpoint that echoes back session
   * identity, including `clubRoles`, the same shape signup/login/refresh
   * return, re-derived from the actor SessionGuard already loaded fresh for
   * this request. `/me` (UsersController) is the editable-profile route and
   * deliberately carries none of this.
   */
  @Get('me')
  @ApiResponse({ status: 401, description: 'Not signed in.', type: ProblemDetailsDto })
  me(@Actor() actor: User): Promise<SessionUser> {
    return this.auth.me(actor);
  }

  /**
   * @Public(): SessionGuard checks the session cookie, which is exactly what
   * refresh exists to replace once it has expired. Requiring a valid one
   * here would make the endpoint unusable for the one case it's for.
   */
  @Public()
  @Post('refresh')
  @HttpCode(200)
  @ApiResponse({ status: 401, description: SESSION_EXPIRED, type: ProblemDetailsDto })
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<SessionUser> {
    const raw = req.cookies?.[REFRESH_COOKIE] as string | undefined;
    // Same message and status as every failure inside AuthService.refresh:
    // a missing cookie is not a distinguishable case either.
    if (!raw) throw new UnauthorizedError(SESSION_EXPIRED);

    const result = await this.auth.refresh(raw);
    this.setAuthCookies(res, result);
    return result.user;
  }

  /**
   * @Public(): an expired (or already cleared) access token must not block
   * logging out. Always 204: see AuthService.logout's doc comment for why
   * "no cookie", "unknown token", and "already revoked" all succeed.
   */
  @Public()
  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    const raw = req.cookies?.[REFRESH_COOKIE] as string | undefined;
    await this.auth.logout(raw);

    const secure = secureCookies(this.config.get('NODE_ENV', { infer: true }));
    res.clearCookie(SESSION_COOKIE, sessionCookieOptions(secure));
    res.clearCookie(REFRESH_COOKIE, refreshCookieOptions(secure));
  }

  /**
   * Tokens live only in httpOnly cookies, never in the JSON response body:
   * the response body is the session user and nothing else, so a token
   * never ends up in a browser devtools network log or an API client's
   * response history.
   */
  private setAuthCookies(res: Response, result: AuthResult): void {
    const secure = secureCookies(this.config.get('NODE_ENV', { infer: true }));
    res.cookie(SESSION_COOKIE, result.accessToken, sessionCookieOptions(secure));
    res.cookie(REFRESH_COOKIE, result.refreshToken, refreshCookieOptions(secure));
  }
}
