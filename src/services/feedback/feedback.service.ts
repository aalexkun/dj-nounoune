import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Subject, Subscription, bufferTime, concatMap, filter, from, map } from 'rxjs';
import { PlaylogService } from '../playlog/playlog.service';
import { Reaction } from '../chat/protocol';
import { getErrorMessage } from '../../utils/error.utils';

/** How long reactions are gathered before being counted onto the playlog. */
const BUFFER_MS = 5_000;

/**
 * Reactions, from wherever they come from, counted onto whatever is playing.
 *
 * This used to live on `ChatService`, keyed by session — which the data never needed. The counts
 * land on the **playlog**, not on anyone's session, and `VibingGateway` had to invent a standing
 * `'vibing-public'` pseudo-session purely so the public page could reuse the same buffering. One
 * global stream both gateways push into removes the pseudo-session and the per-session map with it.
 *
 * The `bufferTime` aggregation itself is unchanged: it was already the right shape.
 */
@Injectable()
export class FeedbackService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(FeedbackService.name);
  private readonly reactions = new Subject<Reaction>();
  private subscription?: Subscription;

  constructor(private readonly playlog: PlaylogService) {}

  onModuleInit(): void {
    this.subscription = this.reactions
      .pipe(
        bufferTime(BUFFER_MS),
        filter((batch) => batch.length > 0),
        map((batch) => batch.reduce<Record<string, number>>((counts, reaction) => ({ ...counts, [reaction]: (counts[reaction] ?? 0) + 1 }), {})),
        // Serialised: two overlapping windows writing the same playlog would race on the counts.
        concatMap((counts) =>
          from(
            this.playlog.handleFeedbackEvent(counts).catch((error: unknown) => {
              // A failed write must not complete the stream — that would silence reactions for the
              // life of the process.
              this.logger.error(`Could not record feedback: ${getErrorMessage(error)}`);
            }),
          ),
        ),
      )
      .subscribe();
  }

  onModuleDestroy(): void {
    this.subscription?.unsubscribe();
    this.reactions.complete();
  }

  /** Called by the chat gateway and by the public /vibing page alike. */
  record(reaction: Reaction): void {
    this.reactions.next(reaction);
  }
}
