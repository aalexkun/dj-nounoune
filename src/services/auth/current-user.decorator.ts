import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AuthenticatedUser } from './auth.types';
import type { AuthenticatedRequest } from './session-auth.guard';

/**
 * The caller, as `SessionAuthGuard` resolved them.
 *
 * `undefined` when the route is not behind that guard, which is a wiring mistake rather than a
 * runtime case — the decorator does not invent an anonymous user, so a handler that forgot its
 * guard fails loudly on the first property read instead of quietly serving somebody else's data.
 */
export const CurrentUser = createParamDecorator((_data: unknown, context: ExecutionContext): AuthenticatedUser | undefined => {
  const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
  return request.user;
});
