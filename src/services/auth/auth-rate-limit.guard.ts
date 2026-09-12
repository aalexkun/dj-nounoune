import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { RedisCacheService } from '../redis-cache/redis-cache.service';

/** Window length in seconds. The counter is created with this TTL and expires on its own. */
const WINDOW_SECONDS = 60;

/** Calls allowed per client per window. Generous for a household, useless for a token guesser. */
const MAX_REQUESTS = 20;

/**
 * A per-IP cap on the sign-in routes.
 *
 * `/auth/*` is the only unauthenticated surface that accepts data from the network, so it is the
 * only place where an attacker gets unlimited attempts at anything. `RedisCacheService.increment`
 * creates the counter with the window's TTL and the window then expires by itself — no sweep, no
 * state of our own.
 *
 * A `null` from Redis (disabled, down, cooling down) **allows** the request. A rate limiter that
 * fails closed would lock the household out of its own server the moment the cache blinks, and the
 * thing being protected is a route that still verifies a Google signature on every call.
 */
@Injectable()
export class AuthRateLimitGuard implements CanActivate {
  constructor(private readonly cache: RedisCacheService) {}

  public async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const count = await this.cache.increment(`auth:ratelimit:${clientIp(request)}`, WINDOW_SECONDS);

    if (count === null) return true;

    if (count > MAX_REQUESTS) {
      throw new HttpException('Too many requests', HttpStatus.TOO_MANY_REQUESTS);
    }

    return true;
  }
}

/** Whatever Express resolved as the peer. Behind a proxy this is the proxy unless `trust proxy` is set. */
function clientIp(request: Request): string {
  return request.ip ?? request.socket?.remoteAddress ?? 'unknown';
}
