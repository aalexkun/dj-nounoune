import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Observable } from 'rxjs';
import type { Request } from 'express';
import { AuthService } from './auth.service';

/** The request once this guard has run: the caller's id is carried for the controllers. */
export type AuthenticatedRequest = Request & { userId?: string };

@Injectable()
export class ApiAuthGuard implements CanActivate {
  constructor(private readonly authService: AuthService) {}

  canActivate(context: ExecutionContext): boolean | Promise<boolean> | Observable<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const apiKey = request.headers['x-api-key'];
    const userId = request.headers['x-user-id'];
    this.authService.checkApiKey(apiKey);

    if (userId) {
      request.userId = Array.isArray(userId) ? userId[0] : userId;
    }

    return true;
  }
}
