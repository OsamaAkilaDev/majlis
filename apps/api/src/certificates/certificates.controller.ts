import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiResponse } from '@nestjs/swagger';
import {
  certificateListQuerySchema,
  reissueCertificateBodySchema,
  revokeCertificateBodySchema,
  type Certificate,
  type CertificateIssueResult,
  type CertificatePage,
  type CertificatePdf,
} from '@majlis/contracts';
import { createZodDto } from 'nestjs-zod';
import { Actor } from '../auth/actor.decorator';
import { RequirePermission } from '../auth/require-permission.decorator';
import { ProblemDetailsDto } from '../common/problem/problem-details.dto';
import type { User } from '../generated/prisma/client';
import { CertificatesService } from './certificates.service';

class CertificateListQueryDto extends createZodDto(certificateListQuerySchema) {}
class RevokeCertificateDto extends createZodDto(revokeCertificateBodySchema) {}
class ReissueCertificateDto extends createZodDto(reissueCertificateBodySchema) {}

@Controller()
export class CertificatesController {
  constructor(private readonly certificates: CertificatesService) {}

  /**
   * Idempotent: a second press issues nothing and answers with the totals,
   * because the partial unique index leaves nothing left to insert.
   */
  @Post('events/:eventId/certificates/issue')
  @HttpCode(200)
  @RequirePermission('certificate:manage')
  @ApiResponse({ status: 403, description: 'You do not have permission to do that.', type: ProblemDetailsDto })
  @ApiResponse({ status: 404, description: 'No such event.', type: ProblemDetailsDto })
  @ApiResponse({ status: 422, description: 'That event is not ready to issue certificates.', type: ProblemDetailsDto })
  issue(@Param('eventId') eventId: string): Promise<CertificateIssueResult> {
    return this.certificates.issue(eventId);
  }

  @Get('events/:eventId/certificates')
  @RequirePermission('registration:read', { scope: 'event', from: 'params.eventId' })
  @ApiResponse({ status: 403, description: 'You do not have permission to do that.', type: ProblemDetailsDto })
  forEvent(
    @Param('eventId') eventId: string,
    @Query() query: CertificateListQueryDto,
  ): Promise<CertificatePage> {
    return this.certificates.forEvent(eventId, query);
  }

  /** Self-scoped by `actor.id`; there is no route that lists another user's. */
  @Get('me/certificates')
  mine(@Actor() actor: User, @Query() query: CertificateListQueryDto): Promise<CertificatePage> {
    return this.certificates.mine(actor, query);
  }

  /**
   * Ownership rather than a permission key: the holder or an Admin. A club
   * officer who may list an event's certificates still has no business
   * downloading somebody else's document.
   */
  @Get('certificates/:id/pdf')
  @ApiResponse({ status: 403, description: 'That certificate belongs to someone else.', type: ProblemDetailsDto })
  @ApiResponse({ status: 404, description: 'No such certificate.', type: ProblemDetailsDto })
  pdf(@Actor() actor: User, @Param('id') id: string): Promise<CertificatePdf> {
    return this.certificates.pdf(actor, id);
  }

  @Post('certificates/:id/revoke')
  @HttpCode(200)
  @RequirePermission('certificate:manage')
  @ApiResponse({ status: 403, description: 'You do not have permission to do that.', type: ProblemDetailsDto })
  @ApiResponse({ status: 404, description: 'No such certificate.', type: ProblemDetailsDto })
  @ApiResponse({ status: 422, description: 'That certificate is already revoked.', type: ProblemDetailsDto })
  revoke(
    @Actor() actor: User,
    @Param('id') id: string,
    @Body() body: RevokeCertificateDto,
  ): Promise<Certificate> {
    return this.certificates.revoke(actor, id, body);
  }

  @Post('certificates/:id/reissue')
  @HttpCode(200)
  @RequirePermission('certificate:manage')
  @ApiResponse({ status: 403, description: 'You do not have permission to do that.', type: ProblemDetailsDto })
  @ApiResponse({ status: 404, description: 'No such certificate.', type: ProblemDetailsDto })
  @ApiResponse({ status: 422, description: 'That certificate is already revoked.', type: ProblemDetailsDto })
  reissue(
    @Actor() actor: User,
    @Param('id') id: string,
    @Body() body: ReissueCertificateDto,
  ): Promise<Certificate> {
    return this.certificates.reissue(actor, id, body);
  }
}
