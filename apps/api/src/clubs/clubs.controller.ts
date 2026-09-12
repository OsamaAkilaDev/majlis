import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiResponse } from '@nestjs/swagger';
import { clubListQuerySchema, createClubBodySchema, type ClubDetail, type ClubPage, type NewClubUpload } from '@majlis/contracts';
import { createZodDto } from 'nestjs-zod';
import { Actor } from '../auth/actor.decorator';
import { RequirePermission } from '../auth/require-permission.decorator';
import { ProblemDetailsDto } from '../common/problem/problem-details.dto';
import type { User } from '../generated/prisma/client';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- must stay a value import: Nest's constructor DI resolves this provider from the emitted `design:paramtypes` metadata, which needs a real runtime reference.
import { ClubsService } from './clubs.service';

class CreateClubDto extends createZodDto(createClubBodySchema) {}
class ClubListQueryDto extends createZodDto(clubListQuerySchema) {}

/**
 * The upload route is a static segment declared ahead of the parameterised
 * `clubs/:clubId` route, so the two can never be confused by declaration
 * order even though they sit on different HTTP methods today.
 */
@Controller()
export class ClubsController {
  constructor(private readonly clubs: ClubsService) {}

  @Post('uploads/club-logo')
  @RequirePermission('club:create')
  @ApiResponse({ status: 403, description: 'You do not have permission to do that.', type: ProblemDetailsDto })
  mintClubLogoUpload(): Promise<NewClubUpload> {
    return this.clubs.mintLogoUpload();
  }

  @Post('clubs')
  @RequirePermission('club:create')
  @ApiResponse({ status: 403, description: 'You do not have permission to do that.', type: ProblemDetailsDto })
  @ApiResponse({ status: 409, description: 'A club with that name already exists.', type: ProblemDetailsDto })
  @ApiResponse({ status: 422, description: 'The uploaded logo failed verification.', type: ProblemDetailsDto })
  create(@Actor() actor: User, @Body() body: CreateClubDto): Promise<ClubDetail> {
    return this.clubs.create(actor, body);
  }

  @Get('clubs')
  @ApiResponse({ status: 400, description: 'limit is over MAX_PAGE_LIMIT.', type: ProblemDetailsDto })
  list(@Actor() actor: User, @Query() query: ClubListQueryDto): Promise<ClubPage> {
    return this.clubs.list(query);
  }

  @Get('clubs/:clubId')
  @ApiResponse({ status: 404, description: 'No such club.', type: ProblemDetailsDto })
  detail(@Actor() actor: User, @Param('clubId') clubId: string): Promise<ClubDetail> {
    return this.clubs.detail(actor, clubId);
  }
}
