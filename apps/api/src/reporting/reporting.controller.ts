import { Controller, Get, Param } from '@nestjs/common';
import { ApiResponse } from '@nestjs/swagger';
import type { ClubReport, OverviewReport } from '@majlis/contracts';
import { RequirePermission } from '../auth/require-permission.decorator';
import { ProblemDetailsDto } from '../common/problem/problem-details.dto';
import { ReportingService } from './reporting.service';

@Controller()
export class ReportingController {
  constructor(private readonly reporting: ReportingService) {}

  // Unscoped, so only the platform half of `report:read` satisfies it: a club
  // Lead holds the permission over their own club and has no scope to present.
  @Get('reports/overview')
  @RequirePermission('report:read')
  overview(): Promise<OverviewReport> {
    return this.reporting.overview();
  }

  @Get('clubs/:clubId/reports')
  @RequirePermission('report:read', { scope: 'club', from: 'params.clubId' })
  @ApiResponse({ status: 404, description: 'No such club.', type: ProblemDetailsDto })
  forClub(@Param('clubId') clubId: string): Promise<ClubReport> {
    return this.reporting.forClub(clubId);
  }
}
