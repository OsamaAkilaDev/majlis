import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiResponse } from '@nestjs/swagger';
import { auditListQuerySchema, type AuditPage } from '@majlis/contracts';
import { createZodDto } from 'nestjs-zod';
import { RequirePermission } from '../auth/require-permission.decorator';
import { ProblemDetailsDto } from '../common/problem/problem-details.dto';
import { AuditReadService } from './audit-read.service';

class AuditListQueryDto extends createZodDto(auditListQuerySchema) {}

// Spec 6.1's "Read audit log" row: Admin over the platform, club Lead scoped
// to their own club. Read-only, both.
@Controller()
export class AuditController {
  constructor(private readonly audit: AuditReadService) {}

  @Get('audit')
  @RequirePermission('audit:read')
  list(@Query() query: AuditListQueryDto): Promise<AuditPage> {
    return this.audit.list(query);
  }

  @Get('clubs/:clubId/audit')
  @RequirePermission('audit:read', { scope: 'club', from: 'params.clubId' })
  @ApiResponse({ status: 404, description: 'No such club.', type: ProblemDetailsDto })
  forClub(@Param('clubId') clubId: string, @Query() query: AuditListQueryDto): Promise<AuditPage> {
    return this.audit.forClub(clubId, query);
  }
}
