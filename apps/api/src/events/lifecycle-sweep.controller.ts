import { Controller, Headers, HttpCode, Post } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiResponse } from '@nestjs/swagger';
import type { SweepResult } from '@majlis/contracts';
import { createHash, timingSafeEqual } from 'node:crypto';
import { SWEEP_SECRET_HEADER } from '../config/sweep-header';
import { Public } from '../auth/public.decorator';
import { UnauthorizedError } from '../common/problem/domain-error';
import { ProblemDetailsDto } from '../common/problem/problem-details.dto';
import type { Env } from '../config/env.schema';
import { CertificatesService } from '../certificates/certificates.service';
import { EventLifecycleService } from './event-lifecycle.service';

export { SWEEP_SECRET_HEADER } from '../config/sweep-header';

/**
 * Compares digests, not the secrets: timingSafeEqual throws on unequal lengths,
 * and a length pre-check is itself a side channel leaking the secret's length.
 */
export function assertSweepSecret(presented: string | undefined, expected: string): void {
  const digest = (v: string) => createHash('sha256').update(v).digest();
  if (!presented || !timingSafeEqual(digest(presented), digest(expected))) {
    throw new UnauthorizedError('That sweep secret is not valid.');
  }
}

// The scheduled backstop of spec 7.3's lazy lifecycle. A shared secret rather
// than a session, because the caller is a scheduler with no user behind it.
@Controller('internal')
export class LifecycleSweepController {
  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly lifecycle: EventLifecycleService,
    private readonly certificates: CertificatesService,
  ) {}

  @Public()
  @Post('lifecycle-sweep')
  @HttpCode(200)
  @ApiResponse({ status: 401, description: 'That sweep secret is not valid.', type: ProblemDetailsDto })
  async sweep(@Headers(SWEEP_SECRET_HEADER) presented: string | undefined): Promise<SweepResult> {
    assertSweepSecret(presented, this.config.get('LIFECYCLE_SWEEP_SECRET', { infer: true }));
    const swept = await this.lifecycle.sweep();
    // After the advances, not before: an event that completed two days ago is
    // due for issuance now, and this is the only path that will notice.
    return { ...swept, certificatesIssued: await this.certificates.issueDue() };
  }
}
