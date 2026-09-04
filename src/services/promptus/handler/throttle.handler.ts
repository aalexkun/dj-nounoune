import { Logger } from '@nestjs/common';
import { PromptusRequest } from '../promptus.request';
import { getModelRateLimit } from '../config';
import { getErrorMessage } from '../../../utils/error.utils';

/** Whatever can count requests atomically across processes. `RedisCacheService.increment` fits as-is. */
export interface DailyRequestCounter {
  increment(key: string, ttlSeconds?: number): Promise<number | null>;
}

/** Google resets Gemini quotas at midnight Pacific, so the daily key follows that calendar. */
const QUOTA_TIMEZONE = 'America/Los_Angeles';

/** The key is only ever read on the day it names; two days is plenty. */
const DAILY_KEY_TTL_SECONDS = 2 * 24 * 60 * 60;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * A per-minute allowance that refills continuously.
 *
 * `acquire` reserves first and waits second: the balance may go negative, and the wait is however
 * long the refill takes to bring it back to zero. Reserving up front is what makes concurrent callers
 * queue correctly - each one's deficit includes the reservations made before it, so five workers
 * hitting an empty bucket wait 1x, 2x, 3x... rather than all leaving together after 1x.
 */
class RateBucket {
  private available: number;
  private lastRefill = Date.now();

  constructor(private readonly perMinute: number) {
    this.available = perMinute;
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    if (elapsed <= 0) return;
    this.available = Math.min(this.perMinute, this.available + (elapsed / 60_000) * this.perMinute);
    this.lastRefill = now;
  }

  /** @returns the milliseconds waited, for the caller's log line */
  async acquire(cost: number): Promise<number> {
    // A single request larger than the whole allowance is let through at full price; it simply
    // holds everything behind it for a minute, which is the honest outcome.
    const actual = Math.min(cost, this.perMinute);
    this.refill();
    this.available -= actual;
    if (this.available >= 0) return 0;

    const waitMs = Math.ceil((-this.available / this.perMinute) * 60_000);
    await sleep(waitMs);
    return waitMs;
  }

  get remaining(): number {
    this.refill();
    return this.available;
  }
}

interface ModelBuckets {
  rpm: RateBucket;
  tpm: RateBucket;
}

/**
 * Keeps traffic inside the per-model quotas declared in `promptus/config.ts`.
 *
 * Per minute - requests and tokens - is enforced: `acquire` blocks until both allowances have room.
 * Per day is counted and reported, never enforced: the count lives in Redis so every process shares
 * it, and the share of the daily quota is logged, with a line at each 10% step.
 *
 * All state is static. The quota belongs to the API key, not to the agent, so the several agents in
 * one process must draw on one set of buckets - an instance is only a handle onto them.
 */
export class ThrottleHandler {
  private readonly logger = new Logger('ThrottleHandler');

  private static readonly buckets = new Map<string, ModelBuckets>();
  private static dailyCounter: DailyRequestCounter | null = null;
  /** Fallback when no counter is attached or Redis is down. Per process, so an undercount. */
  private static readonly localDaily = new Map<string, number>();
  /** The last 10% step announced per daily key, so each step is logged once. */
  private static readonly announcedDecile = new Map<string, number>();

  /** Called once by `PromptusService`. */
  static useDailyCounter(counter: DailyRequestCounter): void {
    ThrottleHandler.dailyCounter = counter;
  }

  private static bucketsFor(model: string): ModelBuckets {
    let buckets = ThrottleHandler.buckets.get(model);
    if (!buckets) {
      const limit = getModelRateLimit(model);
      buckets = { rpm: new RateBucket(limit.rpm), tpm: new RateBucket(limit.tpm) };
      ThrottleHandler.buckets.set(model, buckets);
    }
    return buckets;
  }

  /** Today in the quota's own calendar, as YYYY-MM-DD. */
  private static quotaDay(): string {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: QUOTA_TIMEZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
  }

  /**
   * Estimate the token size of a request.
   * Rule: 1 token = 8 bytes.
   */
  private calculateTokenCost(request: PromptusRequest<unknown>): number {
    let totalTokens = 0;

    // 1. Calculate tokens from cache if present
    if (request.cache?.usageMetadata?.totalTokenCount) {
      totalTokens += request.cache.usageMetadata.totalTokenCount;
    } else if (request.context) {
      // Only read context if cache doesn't exist or doesn't provide token usage.
      const contextBytes = Buffer.byteLength(request.contextContent, 'utf-8');
      totalTokens += Math.ceil(contextBytes / 8);
    }

    // 2. Add tokens from the query
    if (request.query) {
      const queryBytes = Buffer.byteLength(request.query, 'utf-8');
      totalTokens += Math.ceil(queryBytes / 8);
    }

    return totalTokens || 1; // Fallback to at least 1 token if everything fails
  }

  /** Block until the request's model has room for one more request and for its estimated tokens. */
  async acquire(request: PromptusRequest<unknown>): Promise<void> {
    const model = request.model;
    const buckets = ThrottleHandler.bucketsFor(model);
    const tokens = this.calculateTokenCost(request);

    const waitedRpm = await buckets.rpm.acquire(1);
    const waitedTpm = await buckets.tpm.acquire(tokens);

    const waited = waitedRpm + waitedTpm;
    if (waited > 0) {
      const hit = [waitedRpm > 0 ? 'RPM' : null, waitedTpm > 0 ? 'TPM' : null].filter(Boolean).join(' + ');
      this.logger.warn(`${model}: ${hit} limit reached, delayed ${waited}ms`);
    } else {
      this.logger.debug(
        `${model}: acquired 1 request + ${tokens} tokens | remaining RPM ${buckets.rpm.remaining.toFixed(0)}, TPM ${buckets.tpm.remaining.toFixed(0)}`,
      );
    }
  }

  /**
   * Count one request against the model's daily quota and report where it stands. Never throws and
   * never blocks - the daily limit is displayed, not enforced.
   */
  async recordRequest(model: string): Promise<void> {
    try {
      const limit = getModelRateLimit(model);
      const key = `genai:rpd:${model}:${ThrottleHandler.quotaDay()}`;

      let count: number | null = null;
      let source = 'redis';
      if (ThrottleHandler.dailyCounter) {
        count = await ThrottleHandler.dailyCounter.increment(key, DAILY_KEY_TTL_SECONDS);
      }
      if (count === null) {
        source = 'this process only';
        count = (ThrottleHandler.localDaily.get(key) ?? 0) + 1;
        ThrottleHandler.localDaily.set(key, count);
      }

      const pct = (count / limit.rpd) * 100;
      const line = `RPD ${model}: ${count}/${limit.rpd} (${pct.toFixed(1)}%, ${source})`;
      this.logger.debug(line);

      const decile = Math.floor(pct / 10);
      if (decile > (ThrottleHandler.announcedDecile.get(key) ?? -1)) {
        ThrottleHandler.announcedDecile.set(key, decile);
        if (pct >= 100) {
          this.logger.error(`${line} - daily quota exceeded; not enforced here, Google will start refusing`);
        } else if (pct >= 80) {
          this.logger.warn(line);
        } else {
          this.logger.log(line);
        }
      }
    } catch (error: unknown) {
      this.logger.debug(`Could not record daily request count: ${getErrorMessage(error)}`);
    }
  }
}
