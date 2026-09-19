import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiResponse } from '@nestjs/swagger';
import {
  appointLeadBodySchema,
  cursorPageQuerySchema,
  endAppointmentBodySchema,
  inviteTeamMemberBodySchema,
  type Appointment,
  type AppointmentPage,
  type InvitationPage,
} from '@majlis/contracts';
import { createZodDto } from 'nestjs-zod';
import { Actor } from '../../auth/actor.decorator';
import { RequirePermission } from '../../auth/require-permission.decorator';
import { ProblemDetailsDto } from '../../common/problem/problem-details.dto';
import type { User } from '../../generated/prisma/client';
import { TeamService } from './team.service';

class AppointLeadDto extends createZodDto(appointLeadBodySchema) {}
class InviteTeamMemberDto extends createZodDto(inviteTeamMemberBodySchema) {}
class EndAppointmentDto extends createZodDto(endAppointmentBodySchema) {}
class TeamListQueryDto extends createZodDto(cursorPageQuerySchema) {}

@Controller()
export class TeamController {
  constructor(private readonly team: TeamService) {}

  @Post('clubs/:clubId/lead')
  @RequirePermission('club:appoint-lead')
  @ApiResponse({ status: 403, description: 'You do not have permission to do that.', type: ProblemDetailsDto })
  @ApiResponse({ status: 404, description: 'No such club.', type: ProblemDetailsDto })
  @ApiResponse({ status: 422, description: 'That club is archived, or you appointed yourself.', type: ProblemDetailsDto })
  appointLead(
    @Actor() actor: User,
    @Param('clubId') clubId: string,
    @Body() body: AppointLeadDto,
  ): Promise<Appointment> {
    return this.team.appointLead(actor, clubId, body);
  }

  @Get('clubs/:clubId/team')
  list(
    @Actor() actor: User,
    @Param('clubId') clubId: string,
    @Query() query: TeamListQueryDto,
  ): Promise<AppointmentPage> {
    return this.team.list(actor, clubId, query);
  }

  @Post('clubs/:clubId/team')
  @RequirePermission('club:team-manage', { scope: 'club', from: 'params.clubId' })
  @ApiResponse({ status: 403, description: 'You do not have permission to do that.', type: ProblemDetailsDto })
  @ApiResponse({ status: 409, description: 'That user already holds that role.', type: ProblemDetailsDto })
  @ApiResponse({ status: 422, description: 'That club is archived, or you invited yourself.', type: ProblemDetailsDto })
  invite(
    @Actor() actor: User,
    @Param('clubId') clubId: string,
    @Body() body: InviteTeamMemberDto,
  ): Promise<Appointment> {
    return this.team.invite(actor, clubId, body);
  }

  @Delete('clubs/:clubId/team/:appointmentId')
  @HttpCode(204)
  @RequirePermission('club:team-manage', { scope: 'club', from: 'params.clubId' })
  @ApiResponse({ status: 403, description: 'You do not have permission to do that.', type: ProblemDetailsDto })
  @ApiResponse({ status: 404, description: 'No such appointment.', type: ProblemDetailsDto })
  @ApiResponse({ status: 422, description: 'You cannot end your own appointment, or it is not active.', type: ProblemDetailsDto })
  end(
    @Actor() actor: User,
    @Param('clubId') clubId: string,
    @Param('appointmentId') appointmentId: string,
    @Body() body: EndAppointmentDto,
  ): Promise<void> {
    return this.team.end(actor, clubId, appointmentId, body);
  }

  /**
   * These three routes carry no @RequirePermission: they are self-scoped by
   * `actor.id` inside TeamService, not by any club or event permission.
   */
  @Get('me/invitations')
  myInvitations(@Actor() actor: User, @Query() query: TeamListQueryDto): Promise<InvitationPage> {
    return this.team.myInvitations(actor, query);
  }

  @Post('appointments/:appointmentId/accept')
  @ApiResponse({ status: 404, description: 'No such invitation.', type: ProblemDetailsDto })
  @ApiResponse({ status: 409, description: 'That club already has an active Lead.', type: ProblemDetailsDto })
  @ApiResponse({ status: 422, description: 'That invitation is no longer open, or has expired.', type: ProblemDetailsDto })
  accept(@Actor() actor: User, @Param('appointmentId') appointmentId: string): Promise<Appointment> {
    return this.team.accept(actor, appointmentId);
  }

  @Post('appointments/:appointmentId/decline')
  @ApiResponse({ status: 404, description: 'No such invitation.', type: ProblemDetailsDto })
  @ApiResponse({ status: 422, description: 'That invitation is no longer open, or has expired.', type: ProblemDetailsDto })
  decline(@Actor() actor: User, @Param('appointmentId') appointmentId: string): Promise<Appointment> {
    return this.team.decline(actor, appointmentId);
  }
}
