import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiResponse } from '@nestjs/swagger';
import {
  cursorPageQuerySchema,
  registerBodySchema,
  registrationListQuerySchema,
  type MyRegistrationPage,
  type Registration,
  type RegistrationPage,
} from '@majlis/contracts';
import { createZodDto } from 'nestjs-zod';
import { Actor } from '../auth/actor.decorator';
import { RequirePermission } from '../auth/require-permission.decorator';
import { ProblemDetailsDto } from '../common/problem/problem-details.dto';
import type { User } from '../generated/prisma/client';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- must stay a value import: Nest's constructor DI resolves this provider from the emitted `design:paramtypes` metadata, which needs a real runtime reference.
import { RegistrationsService } from './registrations.service';

class RegisterDto extends createZodDto(registerBodySchema) {}
class RegistrationListQueryDto extends createZodDto(registrationListQuerySchema) {}
class CursorPageQueryDto extends createZodDto(cursorPageQuerySchema) {}

@Controller()
export class RegistrationsController {
  constructor(private readonly registrations: RegistrationsService) {}

  /**
   * No @RequirePermission: spec 6.1's "Register for an event" row reads "as
   * student" for every role, so this is self-scoped by `actor.id`. The Admin
   * override in the body is checked inside the service, against the actor's
   * real platform role.
   */
  @Post('events/:eventId/registrations')
  @ApiResponse({ status: 403, description: 'Only an administrator may register someone else.', type: ProblemDetailsDto })
  @ApiResponse({ status: 404, description: 'No such event.', type: ProblemDetailsDto })
  @ApiResponse({ status: 409, description: 'That event is full and has no waitlist.', type: ProblemDetailsDto })
  @ApiResponse({ status: 422, description: 'Registration is not open, or you are not eligible.', type: ProblemDetailsDto })
  register(
    @Actor() actor: User,
    @Param('eventId') eventId: string,
    @Body() body: RegisterDto,
  ): Promise<Registration> {
    return this.registrations.register(actor, eventId, body);
  }

  @Delete('events/:eventId/registrations/me')
  @HttpCode(204)
  @ApiResponse({ status: 404, description: 'No such event, or you are not registered for it.', type: ProblemDetailsDto })
  @ApiResponse({ status: 422, description: 'That event no longer accepts registration changes.', type: ProblemDetailsDto })
  cancel(@Actor() actor: User, @Param('eventId') eventId: string): Promise<void> {
    return this.registrations.cancel(actor, eventId);
  }

  // The attendee roster carries full names and email addresses. Spec 6.1
  // excludes Marketing from it by design, not by oversight.
  @Get('events/:eventId/registrations')
  @RequirePermission('registration:read', { scope: 'event', from: 'params.eventId' })
  @ApiResponse({ status: 403, description: 'You do not have permission to do that.', type: ProblemDetailsDto })
  roster(
    @Param('eventId') eventId: string,
    @Query() query: RegistrationListQueryDto,
  ): Promise<RegistrationPage> {
    return this.registrations.roster(eventId, query);
  }

  @Get('me/registrations')
  mine(@Actor() actor: User, @Query() query: CursorPageQueryDto): Promise<MyRegistrationPage> {
    return this.registrations.mine(actor, query);
  }
}
