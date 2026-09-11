import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { User } from '../generated/prisma/client';

/**
 * The User row SessionGuard loaded for this request. Only meaningful behind
 * the guard — every non-@Public() route — so a handler that reaches for it
 * always gets a real, currently-ACTIVE user, never a client-supplied claim.
 */
export const Actor = createParamDecorator((_: unknown, ctx: ExecutionContext): User => {
  const req = ctx.switchToHttp().getRequest<{ actor: User }>();
  return req.actor;
});
