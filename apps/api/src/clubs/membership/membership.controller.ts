import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiResponse } from '@nestjs/swagger';
import {
  addMemberBodySchema,
  cursorPageQuerySchema,
  decideMembershipBodySchema,
  memberListQuerySchema,
  removeMemberBodySchema,
  type Member,
  type MemberPage,
  type MyClubPage,
} from '@majlis/contracts';
import { createZodDto } from 'nestjs-zod';
import { Actor } from '../../auth/actor.decorator';
import { RequirePermission } from '../../auth/require-permission.decorator';
import { ProblemDetailsDto } from '../../common/problem/problem-details.dto';
import type { User } from '../../generated/prisma/client';
import { MembershipService } from './membership.service';

class AddMemberDto extends createZodDto(addMemberBodySchema) {}
class DecideMembershipDto extends createZodDto(decideMembershipBodySchema) {}
class MemberListQueryDto extends createZodDto(memberListQuerySchema) {}
class RemoveMemberDto extends createZodDto(removeMemberBodySchema) {}
class CursorPageQueryDto extends createZodDto(cursorPageQuerySchema) {}

@Controller()
export class MembershipController {
  constructor(private readonly membership: MembershipService) {}

  @Get('clubs/:clubId/members')
  members(
    @Actor() actor: User,
    @Param('clubId') clubId: string,
    @Query() query: MemberListQueryDto,
  ): Promise<MemberPage> {
    return this.membership.members(actor, clubId, query);
  }

  @Post('clubs/:clubId/members')
  @RequirePermission('membership:decide', { scope: 'club', from: 'params.clubId' })
  @ApiResponse({ status: 403, description: 'You do not have permission to do that.', type: ProblemDetailsDto })
  @ApiResponse({ status: 404, description: 'No such club.', type: ProblemDetailsDto })
  @ApiResponse({ status: 409, description: 'That user already has an open membership.', type: ProblemDetailsDto })
  @ApiResponse({ status: 422, description: 'That club is not accepting new activity, or its policy is CLOSED.', type: ProblemDetailsDto })
  addMember(@Actor() actor: User, @Param('clubId') clubId: string, @Body() body: AddMemberDto): Promise<Member> {
    return this.membership.addMember(actor, clubId, body);
  }

  @Delete('clubs/:clubId/members/:userId')
  @HttpCode(204)
  @RequirePermission('membership:decide', { scope: 'club', from: 'params.clubId' })
  @ApiResponse({ status: 403, description: 'You do not have permission to do that.', type: ProblemDetailsDto })
  @ApiResponse({ status: 404, description: 'No such club, or no such member.', type: ProblemDetailsDto })
  @ApiResponse({ status: 422, description: 'That club is archived.', type: ProblemDetailsDto })
  remove(
    @Actor() actor: User,
    @Param('clubId') clubId: string,
    @Param('userId') userId: string,
    @Body() body: RemoveMemberDto,
  ): Promise<void> {
    return this.membership.remove(actor, clubId, userId, body);
  }

  /**
   * These two routes carry no @RequirePermission: they are self-scoped by
   * `actor.id` inside MembershipService, not by any club permission.
   */
  @Post('clubs/:clubId/membership-requests')
  @ApiResponse({ status: 404, description: 'No such club.', type: ProblemDetailsDto })
  @ApiResponse({ status: 409, description: 'You already have an open membership in that club.', type: ProblemDetailsDto })
  @ApiResponse({ status: 422, description: 'That club is not accepting new activity, or its policy refuses this.', type: ProblemDetailsDto })
  request(@Actor() actor: User, @Param('clubId') clubId: string): Promise<Member> {
    return this.membership.request(actor, clubId);
  }

  @Delete('clubs/:clubId/membership')
  @HttpCode(204)
  @ApiResponse({ status: 404, description: 'No such club, or no open membership to leave.', type: ProblemDetailsDto })
  @ApiResponse({ status: 422, description: 'That club is archived.', type: ProblemDetailsDto })
  leave(@Actor() actor: User, @Param('clubId') clubId: string): Promise<void> {
    return this.membership.leave(actor, clubId);
  }

  @Patch('clubs/:clubId/membership-requests/:requestId')
  @RequirePermission('membership:decide', { scope: 'club', from: 'params.clubId' })
  @ApiResponse({ status: 403, description: 'You do not have permission to do that.', type: ProblemDetailsDto })
  @ApiResponse({ status: 404, description: 'No such club, or no such request.', type: ProblemDetailsDto })
  @ApiResponse({ status: 422, description: 'That club is archived, you cannot decide your own request, or it is not pending.', type: ProblemDetailsDto })
  decide(
    @Actor() actor: User,
    @Param('clubId') clubId: string,
    @Param('requestId') requestId: string,
    @Body() body: DecideMembershipDto,
  ): Promise<Member> {
    return this.membership.decide(actor, clubId, requestId, body);
  }

  @Get('me/clubs')
  myClubs(@Actor() actor: User, @Query() query: CursorPageQueryDto): Promise<MyClubPage> {
    return this.membership.myClubs(actor, query);
  }
}
