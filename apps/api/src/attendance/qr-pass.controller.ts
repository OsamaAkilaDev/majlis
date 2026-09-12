import { Controller, Get, HttpCode, Post } from '@nestjs/common';
import { ApiResponse } from '@nestjs/swagger';
import type { QrPass } from '@majlis/contracts';
import { Actor } from '../auth/actor.decorator';
import { ProblemDetailsDto } from '../common/problem/problem-details.dto';
import type { User } from '../generated/prisma/client';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- must stay a value import: Nest's constructor DI resolves this provider from the emitted `design:paramtypes` metadata, which needs a real runtime reference.
import { QrPassService } from './qr-pass.service';

/**
 * Both routes are scoped by `actor.id` and take no user id from anywhere, so
 * there is no @RequirePermission and, more to the point, no route in the
 * product that can return anybody else's token.
 */
@Controller()
export class QrPassController {
  constructor(private readonly passes: QrPassService) {}

  @Get('me/qr-pass')
  @ApiResponse({ status: 401, description: 'Not signed in.', type: ProblemDetailsDto })
  mine(@Actor() actor: User): Promise<QrPass> {
    return this.passes.mine(actor.id);
  }

  @Post('me/qr-pass/rotate')
  @HttpCode(200)
  @ApiResponse({ status: 401, description: 'Not signed in.', type: ProblemDetailsDto })
  rotate(@Actor() actor: User): Promise<QrPass> {
    return this.passes.rotate(actor.id);
  }
}
