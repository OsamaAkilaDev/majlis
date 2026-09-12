import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiResponse } from '@nestjs/swagger';
import {
  appointLeadBodySchema,
  cursorPageQuerySchema,
  endAppointmentBodySchema,
  inviteTeamMemberBodySchema,
  type Appointment,
  type AppointmentPage,
} from '@majlis/contracts';
import { createZodDto } from 'nestjs-zod';
import { Actor } from '../../auth/actor.decorator';
import { RequirePermission } from '../../auth/require-permission.decorator';
import { ProblemDetailsDto } from '../../common/problem/problem-details.dto';
import type { User } from '../../generated/prisma/client';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- must stay a value import: Nest's constructor DI resolves this provider from the emitted `design:paramtypes` metadata, which needs a real runtime reference.
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
  list(@Param('clubId') clubId: string, @Query() query: TeamListQueryDto): Promise<AppointmentPage> {
    return this.team.list(clubId, query);
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
}
