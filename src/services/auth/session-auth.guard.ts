import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { AuthService } from './auth.service';
import { AuthSessionService } from './auth-session.service';
import { AuthenticatedUser } from './auth.types';

/**
 * The request once this guard has run: the caller is carried on it for `@CurrentUser()`, and the
 * hash of the bearer that authorised the call for `DELETE /auth/session`. Absent on the legacy
 * path, where there is no session to revoke.
 */
export type AuthenticatedRequest = Request & { user?: AuthenticatedUser; sessionTokenHash?: string };

/**
 * The REST guard: `Authorization: Bearer <session token>`, with the legacy pair beside it.
 *
 * Two paths live here for exactly as long as `AUTHX_API_KEY` is set **and** `AUTHX_API_KEY_ENABLED`
 * is `true`; unset, the pair is off. The bearer is the real one — a token minted for one device,
 * revocable on its own. The legacy pair (`x-api-key` + `x-user-id`) is the shared key every APK
 * ever built carries, and it believes whatever user id the caller asserts; it is kept only so a
 * phone running an old build keeps working while the new one rolls out, and removing the flag (or
 * the key) removes the path without a code change.
 *
 * A bearer that is present but invalid is never quietly demoted to the legacy path: presenting a
 * dead session must read as "sign in again", not as "fall back to the shared key".
 */
@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(
    private readonly sessions: AuthSessionService,
    private readonly authService: AuthService,
  ) {}

  public async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

    const bearer = readBearer(request.headers.authorization);
    if (bearer) {
      const resolved = await this.sessions.resolveToken(bearer);
      if (!resolved) {
        throw new UnauthorizedException('Session is invalid or expired');
      }

      request.user = resolved.user;
      request.sessionTokenHash = resolved.tokenHash;
      return true;
    }

    if (this.authService.isLegacyEnabled()) {
      const apiKey = first(request.headers['x-api-key']);
      const userId = first(request.headers['x-user-id']);

      if (apiKey && userId && this.authService.validateApiKey(apiKey)) {
        request.user = { id: userId, legacy: true };
        return true;
      }
    }

    throw new UnauthorizedException('Authentication required');
  }
}

/** `Authorization: Bearer <token>`, case-insensitive on the scheme as RFC 7235 requires. */
function readBearer(header: string | undefined): string | null {
  if (!header) return null;

  const [scheme, ...rest] = header.trim().split(/\s+/);
  if (scheme.toLowerCase() !== 'bearer') return null;

  const token = rest.join('');
  return token.length > 0 ? token : null;
}

function first(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}
