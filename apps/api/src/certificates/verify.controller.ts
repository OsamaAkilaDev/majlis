import { Controller, Get, Param } from '@nestjs/common';
import { ApiResponse } from '@nestjs/swagger';
import type { Verification } from '@majlis/contracts';
import { Public } from '../auth/public.decorator';
import { ProblemDetailsDto } from '../common/problem/problem-details.dto';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- must stay a value import: Nest's constructor DI resolves this provider from the emitted `design:paramtypes` metadata, which needs a real runtime reference.
import { CertificatesService } from './certificates.service';

/**
 * The one anonymous route in the product. Its own controller, so nothing
 * authenticated can ever be added beside it by accident: @Public() on a
 * handler inside CertificatesController would sit one line away from six
 * routes that must never be public.
 *
 * Not rate limited today, deferred to Stage 8 with the rest, decided
 * 2026-09-12. What makes that safe is the code: 128 bits of
 * crypto.randomBytes leaves nothing to enumerate, and the route is one
 * indexed read. The response shape is not part of that argument. A miss
 * answers 404 and a hit answers 200, sooner, so the two are perfectly
 * distinguishable; the shape's job is to cap what a HIT discloses.
 */
@Controller()
export class VerifyController {
  constructor(private readonly certificates: CertificatesService) {}

  @Public()
  @Get('verify/:code')
  @ApiResponse({ status: 404, description: 'No certificate matches that code.', type: ProblemDetailsDto })
  verify(@Param('code') code: string): Promise<Verification> {
    return this.certificates.verify(code);
  }
}
