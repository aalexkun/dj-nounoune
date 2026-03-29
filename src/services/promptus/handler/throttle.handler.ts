import { GoogleGenAI } from '@google/genai';

import { Logger } from '@nestjs/common';
import { PromptusRequest } from '../promptus.request';

export class ThrottleHandler {
  private readonly logger = new Logger('ThrottleHandler');
  private readonly tokensPerMinute: number;
  private availableTokens: number;
  private lastRefillTime: number;

  constructor(
    private client: GoogleGenAI,
    tokensPerMinute: number = 1_000_000,
  ) {
    this.tokensPerMinute = tokensPerMinute;
    this.availableTokens = tokensPerMinute;
    this.lastRefillTime = Date.now();
  }

  /**
   * Refills the bucket based on the time elapsed since the last refill.
   */
  private refillTokens(): void {
    const now = Date.now();
    const elapsedTimeMs = now - this.lastRefillTime;

    if (elapsedTimeMs > 0) {
      // 1 minute = 60,000 ms
      const tokensToAdd = (elapsedTimeMs / 60_000) * this.tokensPerMinute;
      this.availableTokens = Math.min(this.tokensPerMinute, this.availableTokens + tokensToAdd);
      this.lastRefillTime = now;
    }
  }

  /**
   * Estimate the token size of a request.
   * Rule: 1 token = 8 bytes.
   */
  private async calculateTokenCost(request: PromptusRequest<any>): Promise<number> {
    let totalTokens = 0;

    // 1. Calculate tokens from cache if present
    if (request.cache?.usageMetadata?.totalTokenCount) {
      totalTokens += request.cache.usageMetadata.totalTokenCount;
    } else if (request.context) {
      // Only read context if cache doesn't exist or doesn't provide token usage.
      const contextStr = await request.getContext();
      const contextBytes = Buffer.byteLength(contextStr, 'utf-8');
      totalTokens += Math.ceil(contextBytes / 8);
    }

    // 2. Add tokens from the query
    if (request.query) {
      const queryBytes = Buffer.byteLength(request.query, 'utf-8');
      totalTokens += Math.ceil(queryBytes / 8);
    }

    return totalTokens || 1; // Fallback to at least 1 token if everything fails
  }

  /**
   * Acquires the necessary tokens for a request.
   * If not enough tokens are available, it waits until they are replenished.
   */
  public async acquireTokens(request: PromptusRequest<any>): Promise<void> {
    const cost = await this.calculateTokenCost(request);

    // If a request itself is larger than the bucket size, simply allow it but empty the bucket
    // to prevent complete gridlock, though it will immediately throttle subsequent requests.
    const actualCost = Math.min(cost, this.tokensPerMinute);

    this.refillTokens();

    if (this.availableTokens >= actualCost) {
      this.logger.debug(`Acquired tokens -> Cost: ${actualCost} | Available: ${this.availableTokens.toFixed(0)}`);
      this.availableTokens -= actualCost;
      return;
    }

    // We need to wait for enough tokens to be refilled
    const tokensDeficit = actualCost - this.availableTokens;
    const timeToWaitMs = Math.ceil((tokensDeficit / this.tokensPerMinute) * 60_000);

    this.logger.warn(`TRM limit reached! Delaying request by ${timeToWaitMs}ms to generate ${tokensDeficit.toFixed(0)} tokens.`);

    return new Promise((resolve) => {
      setTimeout(() => {
        // Refill after waiting, which should give us exactly or slightly more than what we need
        this.refillTokens();
        this.availableTokens -= actualCost;
        this.logger.debug(`Resume request -> Deducted: ${actualCost} | Remaining: ${this.availableTokens.toFixed(0)}`);
        resolve();
      }, timeToWaitMs);
    });
  }
}
