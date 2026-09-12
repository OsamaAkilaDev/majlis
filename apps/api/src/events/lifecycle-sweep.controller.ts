import { Controller, Headers, HttpCode, Post } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- value import: Nest DI resolves this from design:paramtypes.
import { ConfigService } from '@nestjs/config';
import { ApiResponse } from '@nestjs/swagger';
import type { SweepResult } from '@majlis/contracts';
import { createHash, timingSafeEqual } from 'node:crypto';
import { SWEEP_SECRET_HEADER } from '../config/sweep-header';
import { Public } from '../auth/public.decorator';
import { UnauthorizedError } from '../common/problem/domain-error';
import { ProblemDetailsDto } from '../common/problem/problem-details.dto';
import type { Env } from '../config/env.schema';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- value import: see above.
import { EventLifecycleService } from './event-lifecycle.service';

export { SWEEP_SECRET_HEADER } from '../config/sweep-header';

/**
 * Compares digests rather than the secrets themselves, so the comparison is
 * both constant-time and constant-LENGTH: timingSafeEqual throws on unequal
 * lengths, and a length pre-check is itself a side channel that leaks how
 * long the real secret is.
 */
export function assertSweepSecret(presented: string | undefined, expected: string): void {
  const digest = (v: string) => createHash('sha256').update(v).digest();
  if (!presented || !timingSafeEqual(digest(presented), digest(expected))) {
    throw new UnauthorizedError('That sweep secret is not valid.');
  }
}

/**
 * The scheduled backstop of spec 7.3's lazy lifecycle. Authenticated by a
 * shared secret rather than a session, because the caller is an external
 * scheduler with no user behind it.
 */
@Controller('internal')
export class LifecycleSweepController {
  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly lifecycle: EventLifecycleService,
  ) {}

  @Public()
  @Post('lifecycle-sweep')
  @HttpCode(200)
  @ApiResponse({ status: 401, description: 'That sweep secret is not valid.', type: ProblemDetailsDto })
  sweep(@Headers(SWEEP_SECRET_HEADER) presented: string | undefined): Promise<SweepResult> {
    assertSweepSecret(presented, this.config.get('LIFECYCLE_SWEEP_SECRET', { infer: true }));
    return this.lifecycle.sweep();
  }
}
